import { formatUnits, parseUnits } from 'viem';
import { adapterFor, getKit, kitChain, signingEnabled } from '../appkit';
import type { SwapAdapter } from './types';

// Circle App Kit swap: USDC, EURC and cirBTC on Arc (routed by Circle's liquidity provider).
const SYMBOLS = new Set(['USDC', 'EURC', 'cirBTC']);

export const circleSwap: SwapAdapter = {
  id: 'circle',
  name: 'Circle',
  supports: (a, b) => a.kind === 'circle' && b.kind === 'circle' && SYMBOLS.has(a.symbol) && SYMBOLS.has(b.symbol) && a.symbol !== b.symbol,
  async quote({ tokenIn, tokenOut, amountIn, slippageBps, provider }) {
    // App Kit quotes for a specific wallet; without one there is no Circle quote.
    if (!provider || !signingEnabled) return undefined;
    const kit = await getKit();
    const adapter = await adapterFor(provider);
    const exact = formatUnits(amountIn, tokenIn.decimals);
    const est = (await kit
      .estimateSwap({
        from: { adapter, chain: kitChain as never },
        tokenIn: tokenIn.symbol as never,
        tokenOut: tokenOut.symbol as never,
        amountIn: exact,
        config: { slippageBps } as never,
      })
      .catch(() => undefined)) as
      | { estimatedOutput: { amount: string }; stopLimit?: { amount: string }; fees?: { type: string; amount: string; token: string }[] }
      | undefined;
    if (!est) return undefined;
    const amountOut = parseUnits(est.estimatedOutput.amount, tokenOut.decimals);
    const minOut = est.stopLimit ? parseUnits(est.stopLimit.amount, tokenOut.decimals) : amountOut;
    return {
      venue: this.id,
      via: 'Circle stablecoin swap',
      amountIn,
      amountOut,
      minOut,
      fee: '0.02% provider fee',
      execution: () => ({
        kind: 'sdk',
        label: `Swap ${exact} ${tokenIn.symbol} to ${tokenOut.symbol}`,
        run: async () =>
          kit.swap({
            from: { adapter, chain: kitChain as never },
            tokenIn: tokenIn.symbol as never,
            tokenOut: tokenOut.symbol as never,
            amountIn: exact,
            config: { slippageBps } as never,
          }),
      }),
    };
  },
};
