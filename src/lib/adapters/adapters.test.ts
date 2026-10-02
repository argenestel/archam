import { decodeAbiParameters } from 'viem';
import { expect, it } from 'vitest';
import { encodeV4Swap, poolId, poolKeyFor } from './uniswapV4';
import { swapAdapters } from './index';
import type { Token } from '../contracts';

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1';

it('derives the live Arc mainnet USDC/EURC 0.05% pool id', () => {
  // Pool with liquidity found on-chain via StateView (scripts/probe-v4.mjs).
  const key = poolKeyFor(EURC, USDC, { fee: 500, tickSpacing: 10 });
  expect(key.currency0).toBe(USDC); // sorted numerically regardless of argument order
  expect(poolId(key)).toBe('0xeb0fd02fb8044d5514fb6e165ee134fd547eff0378bb33b76f4b81d8b03bd1ae');
});

it('encodes a v4 exact-in swap as SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL with the hop price floor', () => {
  const key = poolKeyFor(USDC, EURC, { fee: 500, tickSpacing: 10 });
  const { commands, inputs } = encodeV4Swap(key, true, 100_000n, 88_000n);
  expect(commands).toBe('0x10'); // Universal Router V4_SWAP
  const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]);
  expect(actions).toBe('0x060c0f');
  // The swap struct has 6 fields incl. minHopPriceX36 (verified against Arc's router by eth_call).
  const [swap] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: [{ type: 'address', name: 'c0' }, { type: 'address', name: 'c1' }, { type: 'uint24', name: 'f' }, { type: 'int24', name: 't' }, { type: 'address', name: 'h' }] },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'minHopPriceX36', type: 'uint256' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    params[0],
  );
  expect(swap.amountIn).toBe(100_000n);
  expect(swap.amountOutMinimum).toBe(88_000n);
  expect(swap.minHopPriceX36).toBe(0n);
  const [settleToken, settleAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]);
  const [takeToken, takeMin] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]);
  expect([settleToken, settleAmount, takeToken, takeMin]).toEqual([USDC, 100_000n, EURC, 88_000n]);
});

it('routes pairs only to venues that can serve them', () => {
  const t = (symbol: string, kind: Token['kind'], address: string): Token => ({ symbol, name: symbol, address: address as `0x${string}`, decimals: 6, kind });
  const usdc = t('USDC', 'circle', USDC);
  const eurc = t('EURC', 'circle', EURC);
  const test = t('tUSDC', 'test', '0x995ac9f68d8fb92d240064692fa63af7cc02663c');
  const ids = (a: Token, b: Token) => swapAdapters.filter((x) => x.supports(a, b)).map((x) => x.id);
  expect(ids(usdc, eurc)).toContain('circle');
  expect(ids(usdc, eurc)).toContain('uniswap-v4');
  expect(ids(usdc, test)).not.toContain('uniswap-v4'); // test assets never reach real venues
  expect(ids(usdc, usdc)).toEqual([]);
});
