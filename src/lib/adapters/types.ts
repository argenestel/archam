import type { Address } from 'viem';
import type { Token } from '../contracts';
import type { TxRequest } from '../tx';

/**
 * One interface for every Arc venue Mofu can trade on. The smart router asks each adapter
 * for a quote and the UI executes the winner. New Arc apps plug in by adding an adapter.
 */
/** A prerequisite transaction (approval) that is skipped when `needed()` resolves false. */
export type PrepStep = { label: string; request: TxRequest; needed: () => Promise<boolean> };

export type Execution =
  /** Contract call(s) through Mofu's tx runner (simulate, bytecode check, receipt). Each prep
   * step is its own explicit click; nothing is chained automatically. */
  | {
      kind: 'contract';
      request: TxRequest;
      approve?: { token: Token; spender: Address; amount: bigint };
      prep?: PrepStep[];
    }
  /** An SDK flow that signs through the wallet itself (Circle App Kit). */
  /** An SDK flow (Circle App Kit). It must sign through the provider the tx runner passes in:
   * that provider journals every submission so an ambiguous failure locks against resubmits. */
  | { kind: 'sdk'; label: string; run: (provider: import('viem').EIP1193Provider) => Promise<unknown> };

export type SwapQuote = {
  venue: string;
  /** Short plain-language description of where the trade happens. */
  via: string;
  amountIn: bigint;
  amountOut: bigint;
  /** Minimum received after slippage, in tokenOut base units. */
  minOut: bigint;
  /** Fee description shown to the user, e.g. "1% curve fee". */
  fee: string;
  /** Builds the transaction(s) for a given recipient at execution time. */
  execution: (account: Address) => Execution;
};

export type QuoteParams = {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  slippageBps: number;
  account?: Address;
  /** Wallet provider, needed by SDK venues (Circle App Kit) to quote for this account. */
  provider?: import('viem').EIP1193Provider;
};

export interface SwapAdapter {
  id: string;
  name: string;
  /** Cheap synchronous check so the router skips venues that can never quote this pair. */
  supports(tokenIn: Token, tokenOut: Token): boolean;
  quote(params: QuoteParams): Promise<SwapQuote | undefined>;
}
