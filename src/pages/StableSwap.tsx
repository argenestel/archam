import { useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { formatUnits } from 'viem';
import Dialog from '../components/Dialog';
import { AmountBox, Notice } from '../components/ui';
import { activeChain, isTestnet } from '../lib/arc';
import { adapterFor, getKit, kitChain, signingEnabled } from '../lib/appkit';
import { baseTokens } from '../lib/contracts';
import { useBalances } from '../lib/data';
import { tryParse } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';

const tokens = baseTokens.filter((t) => t.kind === 'circle');
export default function StableSwap() {
  const { address, provider, onArc, switchNetwork, gas } = useWallet();
  const { runExternal, busy, unresolved, externalPending } = useTx();
  const [fromSymbol, setFrom] = useState('USDC');
  const [toSymbol, setTo] = useState('EURC');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [review, setReview] = useState(false);
  const from = tokens.find((t) => t.symbol === fromSymbol)!;
  const to = tokens.find((t) => t.symbol === toSymbol)!;
  const balances = useBalances(address, tokens);
  const balance = balances.data?.[from.address.toLowerCase()];
  const input = tryParse(amount, from.decimals);
  const exact = formatUnits(input, from.decimals);
  const quote = useQuery(
    address && provider && onArc && input && fromSymbol !== toSymbol
      ? `appkit:swap:${activeChain.id}:${address}:${fromSymbol}:${toSymbol}:${input}:${slippage}`
      : null,
    async () => {
      const kit = await getKit();
      const adapter = await adapterFor(provider!);
      const estimate = await kit.estimateSwap({
        from: { adapter, chain: kitChain },
        tokenIn: fromSymbol,
        tokenOut: toSymbol,
        amountIn: exact,
        config: { slippageBps: slippage },
      });
      return {
        out: estimate.estimatedOutput.amount,
        min: estimate.stopLimit.amount,
        fees: estimate.fees ?? [],
        at: Date.now(),
      };
    },
    15_000,
  );
  const problem = !signingEnabled
    ? 'Swaps disabled in this build'
    : unresolved || externalPending
      ? 'Resolve previous transaction'
      : fromSymbol === toSymbol
        ? 'Select different tokens'
        : !input
          ? 'Enter an amount'
          : balance === undefined
            ? 'Loading balance…'
            : input > balance
              ? `Insufficient ${fromSymbol}`
              : gas === undefined
                ? 'Loading gas balance…'
                : fromSymbol === 'USDC' && gas < input * 10n ** 12n + 50_000_000_000_000_000n
                  ? 'Leave at least 0.05 USDC for gas'
                  : gas < 50_000_000_000_000_000n
                    ? 'Keep at least 0.05 USDC for gas'
                    : quote.error
                      ? 'No route right now'
                      : !quote.data || quote.loading
                        ? 'Fetching quote…'
                        : undefined;
  const tokenControl = (side: 'from' | 'to') => (
    <select
      className="token-tag"
      aria-label={side === 'from' ? 'Pay token' : 'Receive token'}
      value={side === 'from' ? fromSymbol : toSymbol}
      onChange={(e) => {
        if (side === 'from') setFrom(e.target.value);
        else setTo(e.target.value);
        setAmount('');
        setReview(false);
      }}
    >
      {tokens.map((t) => (
        <option key={t.symbol}>{t.symbol}</option>
      ))}
    </select>
  );
  return (
    <section className="card trade-panel" aria-label="Circle swap">
      <AmountBox
        label="You pay"
        value={amount}
        onChange={(v) => {
          setAmount(v);
          setReview(false);
        }}
        decimals={from.decimals}
        balance={balance}
        onMax={
          balance
            ? () =>
                setAmount(
                  formatUnits(
                    fromSymbol === 'USDC' ? (balance > 50_000n ? balance - 50_000n : 0n) : balance,
                    from.decimals,
                  ),
                )
            : undefined
        }
        token={tokenControl('from')}
      />
      <div className="swap-flip">
        <button
          aria-label="Reverse direction"
          onClick={() => {
            setFrom(toSymbol);
            setTo(fromSymbol);
            setAmount('');
            setReview(false);
          }}
        >
          <ArrowDownUp size={16} />
        </button>
      </div>
      <AmountBox
        label="You receive"
        value={input && fromSymbol !== toSymbol ? (quote.data?.out ?? '') : ''}
        readOnly
        decimals={to.decimals}
        token={tokenControl('to')}
      />
      <div className="row between">
        <span className="muted">Slippage</span>
        <div className="tabs" role="group" aria-label="Swap slippage">
          {[30, 50, 100].map((b) => (
            <button
              key={b}
              aria-pressed={slippage === b}
              onClick={() => {
                setSlippage(b);
                setReview(false);
              }}
            >
              {b / 100}%
            </button>
          ))}
        </div>
      </div>
      {quote.data && input > 0n && (
        <dl className="kv">
          <div>
            <dt>Minimum received</dt>
            <dd>
              {quote.data.min} {to.symbol}
            </dd>
          </div>
          {quote.data.fees.map((f, i) => (
            <div key={i}>
              <dt>{f.type === 'gas' ? 'Network fee' : 'Provider fee'}</dt>
              <dd>
                {f.amount} {f.token}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {quote.error && input > 0n && (
        <Notice tone="warn">No live route for this pair or amount. Nothing has been sent.</Notice>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={busy || (!!address && onArc && !!problem)}
        onClick={() => (!address ? openConnect() : !onArc ? switchNetwork() : setReview(true))}
      >
        {!address
          ? 'Connect wallet'
          : !onArc
            ? 'Switch to Arc'
            : busy
              ? 'Confirm in your wallet'
              : problem || 'Review swap'}
      </button>
      <p className="faint">
        Circle App Kit routes on {activeChain.name}. USDC also pays gas.{' '}
        {isTestnet
          ? 'Testnet assets have no value.'
          : 'Real funds: rates and liquidity can change.'}
      </p>
      {review && (
        <Dialog title="Review swap" close={() => setReview(false)}>
          <div className="dialog-body">
            <Notice tone="warn">
              {isTestnet ? 'Testnet transaction.' : 'Arc mainnet — this spends real funds.'} Review
              every wallet approval and transaction.
            </Notice>
            <dl className="kv">
              <div>
                <dt>You pay</dt>
                <dd>
                  {exact} {fromSymbol}
                </dd>
              </div>
              <div>
                <dt>Quoted minimum</dt>
                <dd>
                  {quote.data?.min} {toSymbol}
                </dd>
              </div>
              <div>
                <dt>Slippage</dt>
                <dd>{slippage / 100}%</dd>
              </div>
            </dl>
            <button
              className="btn btn-primary btn-block"
              disabled={busy || !!problem || !quote.data || Date.now() - quote.data.at > 30_000}
              onClick={async () => {
                if (!onArc || problem || !quote.data || Date.now() - quote.data.at > 30_000) return;
                const done = await runExternal(
                  `Swap ${exact} ${fromSymbol} to ${toSymbol}`,
                  async (guarded) => {
                    const kit = await getKit();
                    const adapter = await adapterFor(guarded);
                    return kit.swap({
                      from: { adapter, chain: kitChain },
                      tokenIn: fromSymbol,
                      tokenOut: toSymbol,
                      amountIn: exact,
                      config: { slippageBps: slippage },
                    });
                  },
                );
                setReview(false);
                if (done) {
                  setAmount('');
                  invalidate('balances');
                }
              }}
            >
              {busy ? 'Confirm in wallet' : 'Confirm swap'}
            </button>
            <p className="faint">
              The SDK obtains a new execution quote; the final bound is enforced by your selected
              slippage. Review the wallet details if the price changes.
            </p>
          </div>
        </Dialog>
      )}
    </section>
  );
}
