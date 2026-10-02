import { circleSwap } from './circle';
import { mofuCurve, mofuV2 } from './mofu';
import type { QuoteParams, SwapAdapter, SwapQuote } from './types';
import { uniswapV4 } from './uniswapV4';

export type { Execution, PrepStep, QuoteParams, SwapAdapter, SwapQuote } from './types';

/** Every swap venue Mofu routes through. Order is only a tiebreak; best output wins. */
export const swapAdapters: SwapAdapter[] = [mofuCurve, mofuV2, uniswapV4, circleSwap];

/**
 * Smart router: ask every venue that supports the pair, in parallel, and rank by output.
 * A venue that errors or has no liquidity simply drops out; it never blocks the others.
 */
export async function quoteAll(params: QuoteParams): Promise<SwapQuote[]> {
  const venues = swapAdapters.filter((a) => a.supports(params.tokenIn, params.tokenOut));
  const quotes = await Promise.all(venues.map((a) => a.quote(params).catch(() => undefined)));
  return quotes
    .filter((q): q is SwapQuote => !!q && q.amountOut > 0n)
    .sort((a, b) => (b.amountOut === a.amountOut ? 0 : b.amountOut > a.amountOut ? 1 : -1));
}
