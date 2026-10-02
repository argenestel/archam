import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

// Uniswap v4 on Arc mainnet (official Uniswap registry; verified on-chain by verify-mainnet).
export const V4_ADDRESSES = {
  PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  V4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  UniversalRouter: '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1',
} as const satisfies Record<string, Address>;

export const STANDARD_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
] as const;
const NO_HOOKS = '0x0000000000000000000000000000000000000000' as Address;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export const v4Abi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

/** Currencies sorted numerically, as Uniswap v4 requires. */
export function poolKeyFor(a: Address, b: Address, tier: { fee: number; tickSpacing: number }): PoolKey {
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { currency0, currency1, fee: tier.fee, tickSpacing: tier.tickSpacing, hooks: NO_HOOKS };
}

/** PoolIdLibrary: keccak256(abi.encode(PoolKey)). */
export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Hookless standard-tier pools for a pair that are initialized and hold liquidity. */
export async function findPools(client: PublicClient, a: Address, b: Address) {
  const pools = await Promise.all(
    STANDARD_TIERS.map(async (tier) => {
      const key = poolKeyFor(a, b, tier);
      const id = poolId(key);
      const [liquidity, slot0] = await Promise.all([
        client.readContract({ address: V4_ADDRESSES.StateView, abi: v4Abi, functionName: 'getLiquidity', args: [id] }),
        client.readContract({ address: V4_ADDRESSES.StateView, abi: v4Abi, functionName: 'getSlot0', args: [id] }),
      ]);
      return { key, id, liquidity, sqrtPriceX96: slot0[0] };
    }),
  );
  return pools.filter((p) => p.liquidity > 0n && p.sqrtPriceX96 > 0n);
}

/**
 * Exact-input quote for one pool. The quoter is a non-view function that simulates the swap,
 * so it is called with eth_call and its return data decoded.
 */
export async function quoteExactInputSingle(
  client: PublicClient,
  { tokenIn, amountIn, key }: { tokenIn: Address; amountIn: bigint; key: PoolKey },
) {
  const zeroForOne = tokenIn.toLowerCase() === key.currency0.toLowerCase();
  const data = encodeFunctionData({
    abi: v4Abi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
  });
  try {
    const result = await client.call({ to: V4_ADDRESSES.V4Quoter, data });
    if (!result.data) return undefined;
    const [amountOut, gasEstimate] = decodeFunctionResult({ abi: v4Abi, functionName: 'quoteExactInputSingle', data: result.data });
    return { amountOut, gasEstimate, zeroForOne };
  } catch {
    return undefined; // e.g. not enough liquidity for this size
  }
}

export async function bestV4Quote(client: PublicClient, tokenIn: Address, tokenOut: Address, amountIn: bigint) {
  const pools = await findPools(client, tokenIn, tokenOut);
  const quotes = await Promise.all(
    pools.map(async (p) => {
      const q = await quoteExactInputSingle(client, { tokenIn, amountIn, key: p.key });
      return q && { ...q, key: p.key, id: p.id };
    }),
  );
  return quotes.filter((q): q is NonNullable<typeof q> => !!q && q.amountOut > 0n).sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0];
}

// ---------------------------------------------------------------- swap adapter

import { erc20Abi, encodeAbiParameters as enc, parseAbi as pa } from 'viem';
import { client as arcClient } from '../arc';
import { deadline } from '../format';
import { withSlippage } from '../math';
import type { SwapAdapter } from './types';

export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;
const permit2Abi = pa([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const urAbi = pa(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
// Universal Router command and v4 action codes (Uniswap v4-periphery Actions.sol).
const V4_SWAP = '0x10';
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

/** Universal Router input for one exact-in single-pool v4 swap. */
export function encodeV4Swap(key: PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint) {
  const tokenIn = zeroForOne ? key.currency0 : key.currency1;
  const tokenOut = zeroForOne ? key.currency1 : key.currency0;
  const actions = `0x${[SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL].map((a) => a.toString(16).padStart(2, '0')).join('')}` as Hex;
  const swapParams = enc(
    [
      {
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          // Arc's Universal Router (v4-periphery ≥ 2025) adds a per-hop price floor; 0 = none.
          // Verified by eth_call: without it the router reverts while decoding.
          { name: 'minHopPriceX36', type: 'uint256' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' }],
  );
  const settle = enc([{ type: 'address' }, { type: 'uint256' }], [tokenIn, amountIn]);
  const take = enc([{ type: 'address' }, { type: 'uint256' }], [tokenOut, minOut]);
  const input = enc([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swapParams, settle, take]]);
  return { commands: V4_SWAP as Hex, inputs: [input] };
}

/** Uniswap v4 hookless pools on Arc mainnet, executed through the Universal Router + Permit2. */
export const uniswapV4: SwapAdapter = {
  id: 'uniswap-v4',
  name: 'Uniswap v4',
  supports: (a, b) => a.kind !== 'test' && b.kind !== 'test' && a.address.toLowerCase() !== b.address.toLowerCase(),
  async quote({ tokenIn, tokenOut, amountIn, slippageBps }) {
    if ((await arcClient.getChainId()) !== 5042) return undefined;
    const best = await bestV4Quote(arcClient as PublicClient, tokenIn.address, tokenOut.address, amountIn);
    if (!best) return undefined;
    const minOut = withSlippage(best.amountOut, slippageBps);
    const router = V4_ADDRESSES.UniversalRouter;
    return {
      venue: this.id,
      via: `Uniswap v4 pool (${best.key.fee / 10_000}% fee tier)`,
      amountIn,
      amountOut: best.amountOut,
      minOut,
      fee: `${best.key.fee / 10_000}% pool fee`,
      execution: (account) => {
        const { commands, inputs } = encodeV4Swap(best.key, best.zeroForOne, amountIn, minOut);
        const expiry = Math.floor(Date.now() / 1000) + 30 * 60;
        return {
          kind: 'contract',
          prep: [
            {
              label: `Approve ${tokenIn.symbol} for Permit2`,
              request: { address: tokenIn.address, abi: erc20Abi, functionName: 'approve', args: [PERMIT2, amountIn] },
              needed: async () =>
                (await arcClient.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'allowance', args: [account, PERMIT2] })) < amountIn,
            },
            {
              label: `Allow Uniswap to spend ${tokenIn.symbol}`,
              request: { address: PERMIT2, abi: permit2Abi, functionName: 'approve', args: [tokenIn.address, router, amountIn, expiry] },
              needed: async () => {
                const [amount, expiration] = await arcClient.readContract({
                  address: PERMIT2,
                  abi: permit2Abi,
                  functionName: 'allowance',
                  args: [account, tokenIn.address, router],
                });
                return amount < amountIn || expiration <= Math.floor(Date.now() / 1000) + 60;
              },
            },
          ],
          request: { address: router, abi: urAbi, functionName: 'execute', args: [commands, inputs, deadline()] },
        };
      },
    };
  },
};
