import { useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { formatUnits } from 'viem';
import { AmountBox, Notice } from '../components/ui';
import { activeChain, circle } from '../lib/arc';
import { adapterFor, getKit, kitChain, signingEnabled } from '../lib/appkit';
import { useBalances } from '../lib/data';
import { tryParse } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';
import type { Token } from '../lib/contracts';

// Same-chain stablecoin swaps routed by Circle App Kit (USDC, EURC on Arc).
const tokens: Token[] = [
  { symbol: 'USDC', name: 'USD Coin', address: circle.usdc, decimals: 6, kind: 'circle' },
  { symbol: 'EURC', name: 'Euro Coin', address: circle.eurc, decimals: 6, kind: 'circle' },
];

export default function StableSwap() {
  const { address, provider, onArc } = useWallet();
  const { runExternal, busy } = useTx();
  const [dir, setDir] = useState(0);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const from = tokens[dir],
    to = tokens[1 - dir];
  const balances = useBalances(address, tokens);
  const balance = balances.data?.[from.address.toLowerCase()];
  const input = tryParse(amount, 6);
  const quote = useQuery(
    address && provider && onArc && input ? `appkit:swap:${from.symbol}:${input}` : null,
    async () => {
      const kit = await getKit();
      const adapter = await adapterFor(provider!);
      const est = await kit.estimateSwap({
        from: { adapter, chain: kitChain as never },
        tokenIn: from.symbol as never,
        tokenOut: to.symbol as never,
        amountIn: Number(amount).toFixed(2),
      });
      const e = est as unknown as { estimatedOutput: { amount: string }; stopLimit?: { amount: string }; fees?: { amount: string; token: string; type: string }[] };
      return { out: e.estimatedOutput.amount, min: e.stopLimit?.amount, fees: e.fees ?? [] };
    },
    15_000,
  );
  const problem = !address
    ? undefined
    : !signingEnabled
      ? 'Swaps are switched off in this build'
      : !input
        ? 'Enter an amount'
        : balance !== undefined && input > balance
          ? `Insufficient ${from.symbol}`
          : quote.error
            ? 'No route right now'
            : !quote.data
              ? 'Fetching quote…'
              : undefined;
  return (
    <section className="card trade-panel" aria-label="Stablecoin swap">
      <AmountBox
        label="You pay"
        value={amount}
        onChange={setAmount}
        decimals={6}
        balance={balance}
        onMax={balance ? () => setAmount(formatUnits(balance, 6)) : undefined}
        token={<span className="token-tag">{from.symbol}</span>}
      />
      <div className="swap-flip">
        <button aria-label="Reverse direction" onClick={() => (setDir(1 - dir), setAmount(''))}>
          <ArrowDownUp size={16} />
        </button>
      </div>
      <AmountBox label="You receive" value={quote.data?.out ?? ''} readOnly decimals={6} token={<span className="token-tag">{to.symbol}</span>} />
      {quote.data && (
        <dl className="kv">
          {quote.data.min && (
            <div>
              <dt>Minimum received</dt>
              <dd>
                {quote.data.min} {to.symbol}
              </dd>
            </div>
          )}
          {quote.data.fees.map((f) => (
            <div key={f.type}>
              <dt>{f.type === 'gas' ? 'Network fee' : 'Provider fee'}</dt>
              <dd>
                {Number(f.amount).toFixed(4)} {f.token}
              </dd>
            </div>
          ))}
          <div>
            <dt>Slippage tolerance</dt>
            <dd>
              <span className="tabs" style={{ padding: 2 }}>
                {[30, 50, 100].map((b) => (
                  <button key={b} style={{ height: 22, padding: '0 8px', fontSize: 12 }} aria-pressed={slippage === b} onClick={() => setSlippage(b)}>
                    {b / 100}%
                  </button>
                ))}
              </span>
            </dd>
          </div>
        </dl>
      )}
      {quote.error && <Notice tone="warn">Circle’s swap service has no route for this pair or size right now. Try a different amount.</Notice>}
      <button
        className="btn btn-primary btn-block"
        disabled={!!problem || busy}
        onClick={async () => {
          if (!address) return openConnect();
          const ok = await runExternal(`Swap ${amount} ${from.symbol} to ${to.symbol}`, async () => {
            const kit = await getKit();
            const adapter = await adapterFor(provider!);
            return kit.swap({
              from: { adapter, chain: kitChain as never },
              tokenIn: from.symbol as never,
              tokenOut: to.symbol as never,
              amountIn: Number(amount).toFixed(2),
              config: { slippageBps: slippage } as never,
            });
          });
          if (ok) {
            setAmount('');
            invalidate('balances');
          }
        }}
      >
        {!address ? 'Connect wallet' : busy ? 'Confirm in your wallet' : problem || `Swap to ${to.symbol}`}
      </button>
      <p className="faint">Routed by Circle on {activeChain.name}. Rates include Circle’s provider fee.</p>
    </section>
  );
}
