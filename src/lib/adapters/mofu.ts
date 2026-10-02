import type { Address } from 'viem';
import { client } from '../arc';
import { USDC, deployments, launchAbi, routerAbi, type Token } from '../contracts';
import { deadline } from '../format';
import { withSlippage } from '../math';
import type { SwapAdapter } from './types';

const isUsdc = (t: Token) => t.address.toLowerCase() === USDC.address.toLowerCase();
const same = (a: Token, b: Token) => a.address.toLowerCase() === b.address.toLowerCase();

async function curveState(token: Address) {
  const c = await client.readContract({ address: deployments.launch!, abi: launchAbi, functionName: 'curves', args: [token] });
  return { exists: c[0] !== '0x0000000000000000000000000000000000000000', graduated: c[3] };
}

/** Mofu bonding curve: USDC ↔ a launch token that has not graduated yet. */
export const mofuCurve: SwapAdapter = {
  id: 'mofu-curve',
  name: 'Mofu curve',
  supports: (a, b) =>
    !!deployments.launch && ((isUsdc(a) && b.kind === 'launch') || (a.kind === 'launch' && isUsdc(b))),
  async quote({ tokenIn, tokenOut, amountIn, slippageBps }) {
    const launchToken = tokenIn.kind === 'launch' ? tokenIn : tokenOut;
    const state = await curveState(launchToken.address);
    if (!state.exists || state.graduated) return undefined;
    const launch = deployments.launch!;
    if (isUsdc(tokenIn)) {
      const [out, charged] = await client.readContract({
        address: launch,
        abi: launchAbi,
        functionName: 'quoteBuy',
        args: [launchToken.address, amountIn],
      });
      if (!out) return undefined;
      const minOut = withSlippage(out, slippageBps);
      return {
        venue: this.id,
        via: `Buy on the ${launchToken.symbol} curve`,
        amountIn: charged,
        amountOut: out,
        minOut,
        fee: '1% curve fee',
        execution: () => ({
          kind: 'contract',
          approve: { token: USDC, spender: launch, amount: amountIn },
          request: { address: launch, abi: launchAbi, functionName: 'buy', args: [launchToken.address, amountIn, minOut, deadline()] },
        }),
      };
    }
    const out = await client.readContract({
      address: launch,
      abi: launchAbi,
      functionName: 'quoteSell',
      args: [launchToken.address, amountIn],
    });
    if (!out) return undefined;
    const minOut = withSlippage(out, slippageBps);
    return {
      venue: this.id,
      via: `Sell on the ${launchToken.symbol} curve`,
      amountIn,
      amountOut: out,
      minOut,
      fee: '1% curve fee',
      // Sells need no approval: the launch contract pulls the seller's own tokens.
      execution: () => ({
        kind: 'contract',
        request: { address: launch, abi: launchAbi, functionName: 'sell', args: [launchToken.address, amountIn, minOut, deadline()] },
      }),
    };
  },
};

/** Mofu's Uniswap V2 deployment: graduated launch tokens (paired with USDC), plus testnet pools. */
export const mofuV2: SwapAdapter = {
  id: 'mofu-v2',
  name: 'Mofu pools (Uniswap V2)',
  supports: (a, b) => !!deployments.router && !same(a, b),
  async quote({ tokenIn, tokenOut, amountIn, slippageBps }) {
    const router = deployments.router!;
    // Launch tokens only trade here after graduation; before that the token is transfer-locked.
    for (const t of [tokenIn, tokenOut])
      if (t.kind === 'launch' && deployments.launch && !(await curveState(t.address)).graduated) return undefined;
    const paths: Address[][] = [[tokenIn.address, tokenOut.address]];
    if (!isUsdc(tokenIn) && !isUsdc(tokenOut)) paths.push([tokenIn.address, USDC.address, tokenOut.address]);
    const results = await Promise.all(
      paths.map((path) =>
        client
          .readContract({ address: router, abi: routerAbi, functionName: 'getAmountsOut', args: [amountIn, path] })
          .then((a) => ({ path, out: a.at(-1)! }))
          .catch(() => undefined),
      ),
    );
    const best = results.filter((r) => r && r.out > 0n).sort((a, b) => (b!.out > a!.out ? 1 : -1))[0];
    if (!best) return undefined;
    const minOut = withSlippage(best.out, slippageBps);
    return {
      venue: this.id,
      via: best.path.length > 2 ? 'Mofu pools, via USDC' : 'Mofu pool',
      amountIn,
      amountOut: best.out,
      minOut,
      fee: `${best.path.length > 2 ? '0.6' : '0.3'}% pool fee`,
      execution: (account) => ({
        kind: 'contract',
        approve: { token: tokenIn, spender: router, amount: amountIn },
        request: {
          address: router,
          abi: routerAbi,
          functionName: 'swapExactTokensForTokens',
          args: [amountIn, minOut, best.path, account, deadline()],
        },
      }),
    };
  },
};
