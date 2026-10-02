import { useMemo, useState } from 'react';
import { ArrowDownUp, ChevronDown } from 'lucide-react';
import { formatUnits } from 'viem';
import Dialog from '../components/Dialog';
import { ActionButton, AmountBox, Avatar, Notice } from '../components/ui';
import { quoteAll, type SwapQuote } from '../lib/adapters';
import { isTestnet } from '../lib/arc';
import { baseTokens, type Token } from '../lib/contracts';
import { useBalances, useLaunches } from '../lib/data';
import { formatAmount, tryParse } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';

const venueName: Record<string, string> = {
  'mofu-curve': 'Mofu curve',
  'mofu-v2': 'Mofu pools',
  'uniswap-v4': 'Uniswap v4',
  circle: 'Circle',
};

/**
 * One swap for every Arc venue Mofu knows: Mofu curves and pools, Uniswap v4 and Circle.
 * Quotes come from all venues in parallel; the best output is preselected, and the user can
 * pick another. Each approval is its own click; nothing chains automatically.
 */
export default function SmartSwap() {
  const { address, provider } = useWallet();
  const launches = useLaunches();
  const tokens = useMemo<Token[]>(
    () => [
      ...baseTokens,
      ...(launches.data ?? []).map((l) => ({
        symbol: l.symbol,
        name: l.name,
        address: l.address,
        decimals: 18,
        kind: 'launch' as const,
      })),
    ],
    [launches.data],
  );
  const [fromSym, setFrom] = useState(isTestnet ? 'tUSDC' : 'USDC');
  const [toSym, setTo] = useState(isTestnet ? 'tETH' : 'EURC');
  const from = tokens.find((t) => t.symbol === fromSym) ?? tokens[0];
  const to = tokens.find((t) => t.symbol === toSym) ?? tokens[1];
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [picker, setPicker] = useState<'from' | 'to'>();
  const [chosen, setChosen] = useState<string>();
  const balances = useBalances(address, tokens);
  const input = tryParse(amount, from.decimals);
  const quotes = useQuery(
    input && from.address !== to.address
      ? `smart:${from.address}:${to.address}:${input}:${slippage}:${address ?? ''}`
      : null,
    () => quoteAll({ tokenIn: from, tokenOut: to, amountIn: input, slippageBps: slippage, account: address, provider }),
    12_000,
  );
  const list = quotes.data ?? [];
  const best = list.find((q) => q.venue === chosen) ?? list[0];
  const balance = balances.data?.[from.address.toLowerCase()];

  return (
    <section className="card trade-panel" aria-label="Swap across Arc">
      <AmountBox
        label="You pay"
        value={amount}
        onChange={(v) => {
          setAmount(v);
          setChosen(undefined);
        }}
        decimals={from.decimals}
        balance={balance}
        onMax={balance ? () => setAmount(formatUnits(balance, from.decimals)) : undefined}
        token={
          <button className="token-tag" onClick={() => setPicker('from')} aria-label={`Pay with ${from.symbol}. Change token`}>
            <Avatar seed={from.address} size={22} round /> {from.symbol} <ChevronDown size={14} />
          </button>
        }
      />
      <div className="swap-flip">
        <button
          aria-label="Reverse direction"
          onClick={() => {
            setFrom(to.symbol);
            setTo(from.symbol);
            setAmount('');
          }}
        >
          <ArrowDownUp size={16} />
        </button>
      </div>
      <AmountBox
        label="You receive"
        value={best ? formatAmount(best.amountOut, to.decimals, 6) : ''}
        readOnly
        decimals={to.decimals}
        balance={balances.data?.[to.address.toLowerCase()]}
        token={
          <button className="token-tag" onClick={() => setPicker('to')} aria-label={`Receive ${to.symbol}. Change token`}>
            <Avatar seed={to.address} size={22} round /> {to.symbol} <ChevronDown size={14} />
          </button>
        }
      />

      {input > 0n && (
        <div role="radiogroup" aria-label="Venue" style={{ display: 'grid', gap: 6 }}>
          {quotes.loading && <p className="muted" style={{ fontSize: 13.5 }}>Finding the best price…</p>}
          {!quotes.loading && !list.length && (
            <Notice tone="warn">No route for this pair or amount.</Notice>
          )}
          {list.map((q, i) => (
            <VenueRow key={q.venue} q={q} to={to} selected={q === best} best={i === 0} onSelect={() => setChosen(q.venue)} />
          ))}
        </div>
      )}

      {best && (
        <dl className="kv">
          <div>
            <dt>Minimum received</dt>
            <dd>
              {formatAmount(best.minOut, to.decimals, 6)} {to.symbol}
            </dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>{best.fee}</dd>
          </div>
          <div>
            <dt>Slippage tolerance</dt>
            <dd>
              <span className="tabs" style={{ padding: 2 }}>
                {[30, 50, 100, 300].map((b) => (
                  <button key={b} style={{ height: 22, padding: '0 8px', fontSize: 12 }} aria-pressed={slippage === b} onClick={() => setSlippage(b)}>
                    {b / 100}%
                  </button>
                ))}
              </span>
            </dd>
          </div>
        </dl>
      )}

      <Execute quote={best} disabledReason={!input ? 'Enter an amount' : balance !== undefined && input > balance ? `Insufficient ${from.symbol}` : undefined} onDone={() => setAmount('')} />

      {picker && (
        <Dialog title="Select a token" close={() => setPicker(undefined)}>
          <div className="dialog-body" style={{ gap: 2 }}>
            {tokens.map((t) => (
              <button
                key={t.address}
                className="option"
                onClick={() => {
                  if (picker === 'from') {
                    if (t.symbol === to.symbol) setTo(from.symbol);
                    setFrom(t.symbol);
                  } else {
                    if (t.symbol === from.symbol) setFrom(to.symbol);
                    setTo(t.symbol);
                  }
                  setAmount('');
                  setPicker(undefined);
                }}
              >
                <Avatar seed={t.address} size={30} round />
                <span className="grow">
                  <b>{t.symbol}</b>
                  <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                    {t.name}
                    {t.kind === 'launch' ? ', Mofu launch' : ''}
                  </span>
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {balances.data ? formatAmount(balances.data[t.address.toLowerCase()] ?? 0n, t.decimals, 4) : ''}
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function VenueRow({ q, to, selected, best, onSelect }: { q: SwapQuote; to: Token; selected: boolean; best: boolean; onSelect: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="option"
      style={{ border: `1px solid ${selected ? 'var(--blue)' : 'var(--line)'}`, background: selected ? 'var(--blue-soft)' : 'var(--panel)' }}
    >
      <span className="grow">
        <b>{venueName[q.venue] ?? q.venue}</b>
        {best && <span className="chip accent" style={{ marginLeft: 8 }}>Best price</span>}
        <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
          {q.via}, {q.fee}
        </span>
      </span>
      <b>
        {formatAmount(q.amountOut, to.decimals, 6)} {to.symbol}
      </b>
    </button>
  );
}

/** Runs the chosen venue: prep steps (each an explicit click), then approval, then the swap. */
function Execute({ quote, disabledReason, onDone }: { quote?: SwapQuote; disabledReason?: string; onDone: () => void }) {
  const { address, onArc, switchNetwork, pending: switching } = useWallet();
  const { send, runExternal, busy, unresolved, externalPending } = useTx();
  const exec = quote && address ? quote.execution(address) : undefined;
  const prep = useQuery(
    exec?.kind === 'contract' && exec.prep?.length && address ? `prep:${quote!.venue}:${address}:${quote!.amountIn}` : null,
    async () => {
      for (const step of exec!.kind === 'contract' ? exec!.prep ?? [] : []) if (await step.needed()) return step.label;
      return '';
    },
    10_000,
  );
  if (!address)
    return (
      <button className="btn btn-primary btn-block" onClick={openConnect}>
        Connect wallet
      </button>
    );
  if (!onArc)
    return (
      <button className="btn btn-primary btn-block" onClick={switchNetwork} disabled={switching}>
        Switch to Arc
      </button>
    );
  // An earlier transaction or SDK batch with no known outcome blocks new submissions; the
  // shell's pending-transaction banner offers "Check receipt" / "Check wallet batch".
  if (unresolved || externalPending)
    return (
      <button className="btn btn-primary btn-block" disabled>
        Resolve previous transaction
      </button>
    );
  if (disabledReason || !quote || !exec)
    return (
      <button className="btn btn-primary btn-block" disabled>
        {disabledReason ?? 'Choose an amount'}
      </button>
    );
  if (exec.kind === 'sdk')
    return (
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={async () => {
          if (await runExternal(exec.label, exec.run)) {
            invalidate('balances');
            onDone();
          }
        }}
      >
        {busy ? 'Confirm in your wallet' : `Swap with ${venueName[quote.venue] ?? quote.venue}`}
      </button>
    );
  const pending = exec.prep?.find((s) => s.label === prep.data);
  if (pending)
    return (
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={async () => {
          await send(pending.label, pending.request);
          prep.refresh();
        }}
      >
        {pending.label}
      </button>
    );
  return (
    <ActionButton
      label={`Swap with ${venueName[quote.venue] ?? quote.venue}`}
      onConnect={openConnect}
      approve={exec.approve}
      request={exec.request}
      disabledReason={exec.prep?.length && prep.data === undefined ? 'Checking approvals…' : undefined}
      onDone={() => {
        invalidate('balances');
        onDone();
      }}
    />
  );
}
