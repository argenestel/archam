import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Sparkles, UserCheck, UserPlus } from 'lucide-react';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { Curve } from '../components/Curve';
import { TokenLogo } from '../components/Media';
import { ActionButton, AddressLink, AmountBox, Avatar, Empty, Notice, Skeleton } from '../components/ui';
import { addressUrl, client } from '../lib/arc';
import { USDC, deployments, graduationQuote, launchAbi, type Token } from '../lib/contracts';
import { useBalances, useFeed, useLaunch, usePositions, type FeedTrade } from '../lib/data';
import { compact, deadline, formatAmount, pct, price, shortAddress, timeAgo, tryParse, usd } from '../lib/format';
import { tradePrice, withSlippage } from '../lib/math';
import { useQuery } from '../lib/query';
import { useRoute } from '../lib/router';
import { useFollows } from '../lib/social';
import { openConnect, useWallet } from '../lib/wallet';

export default function TokenPage({ address }: { address: Address }) {
  const launch = useLaunch(address);
  const trades = useFeed(address, 200);
  const l = launch.data;
  if (launch.error && !l) return <Notice tone="error">{launch.error}</Notice>;
  if (!l)
    return (
      <div className="token-page">
        <Skeleton h={420} />
        <Skeleton h={420} />
      </div>
    );
  if (l.creator === '0x0000000000000000000000000000000000000000')
    return (
      <div className="card">
        <Empty title="Not an Orbit launch" action={<a className="btn btn-ghost" href="#/">Back to discover</a>}>
          This address was not created by the Orbit launch contract.
        </Empty>
      </div>
    );
  const first = trades.data?.at(-1);
  const firstPrice = first ? tradePrice(first.quoteAmount, first.tokenAmount) : l.price;
  const change = firstPrice ? l.price / firstPrice - 1 : 0;
  const token: Token = { symbol: l.symbol, name: l.name, address: l.address, decimals: 18, kind: 'launch' };
  const remaining = graduationQuote > l.realQuote ? graduationQuote - l.realQuote : 0n;
  return (
    <>
      <a className="btn-quiet row" href="#/" style={{ marginBottom: 16, width: 'fit-content' }}>
        <ArrowLeft size={15} /> Launches
      </a>
      <div className="token-page">
        <div className="stack">
          <div className="token-hero">
            <TokenLogo uri={l.image} seed={l.address} size={64} />
            <div className="grow">
              <h1>
                {l.name} <span className="muted" style={{ fontSize: '0.6em' }}>${l.symbol}</span>
              </h1>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
                Launched {timeAgo(l.createdAt)} ago by <a className="link" href={`#/profile/${l.creator}`}>{shortAddress(l.creator)}</a>
              </p>
            </div>
            {l.graduated && (
              <span className="chip gold">
                <Sparkles size={11} /> On Uniswap
              </span>
            )}
          </div>
          <section className="card chart-card" aria-label="Price chart">
            <div className="row between wrap">
              <div>
                <div className="chart-price">{price(l.price)}</div>
                <div className={`mono ${change >= 0 ? 'up' : 'down'}`} style={{ fontSize: 13, marginTop: 6 }}>
                  {change >= 0 ? '+' : ''}
                  {pct(change)} since launch
                </div>
              </div>
              <dl className="stats" style={{ flex: 1, maxWidth: 440 }}>
                <div className="stat">
                  <dt>Market cap</dt>
                  <dd>{usd(l.marketCap)}</dd>
                </div>
                <div className="stat">
                  <dt>Volume</dt>
                  <dd>{usd(Number(l.volume) / 1e6)}</dd>
                </div>
                <div className="stat">
                  <dt>Trades</dt>
                  <dd>{compact(l.trades, 0)}</dd>
                </div>
              </dl>
            </div>
            <PriceChart trades={trades.data} current={l.price} />
          </section>
          <TradesTable trades={trades.data} loading={trades.loading} symbol={l.symbol} />
        </div>
        <div className="side">
          {l.graduated ? (
            <div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
              <h3>Trading moved to Uniswap V2</h3>
              <p className="muted" style={{ fontSize: 13.5 }}>
                The curve sold out. Its USDC and reserved tokens were added to a Uniswap V2 pool and the LP tokens
                were burned, so the liquidity cannot be withdrawn.
              </p>
              <a className="btn btn-primary" href="#/swap">
                Swap ${l.symbol}
              </a>
              <a className="link" href={addressUrl(l.pair)} target="_blank" rel="noreferrer">
                Pool contract <ExternalLink size={11} />
              </a>
            </div>
          ) : (
            <TradePanel token={token} />
          )}
          <div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
            <div className="row between">
              <h3 style={{ fontSize: 15 }}>Price curve</h3>
              <span>{pct(l.progress)} sold</span>
            </div>
            <Curve variant="hero" progress={l.progress} graduated={l.graduated} label={`${pct(l.progress)} of the curve sold`} />
            <p className="muted" style={{ fontSize: 13 }}>
              {l.graduated
                ? 'Graduated. Liquidity is locked in Uniswap V2.'
                : `${usd(Number(remaining) / 1e6)} more USDC into the curve graduates ${l.symbol} to Uniswap V2.`}
            </p>
            <dl className="kv">
              <div>
                <dt>USDC in curve</dt>
                <dd>{usd(Number(l.realQuote) / 1e6)}</dd>
              </div>
              <div>
                <dt>Tokens left on curve</dt>
                <dd>{compact(Number(formatUnits(l.tokensLeft, 18)))}</dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>
                  <AddressLink address={l.address}>{shortAddress(l.address)}</AddressLink>
                </dd>
              </div>
            </dl>
            {l.description && <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{l.description}</p>}
          </div>
          <YourPosition token={l.address} symbol={l.symbol} priceNow={l.price} />
        </div>
      </div>
    </>
  );
}

function TradePanel({ token }: { token: Token }) {
  const route = useRoute();
  const { address } = useWallet();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState(route.page === 'token' && route.buy ? route.buy : '');
  const [slippage, setSlippage] = useState(200);
  useEffect(() => {
    if (route.page === 'token' && route.buy) {
      setSide('buy');
      setAmount(route.buy);
    }
  }, [route]);
  const balances = useBalances(address, [USDC, token]);
  const usdcBalance = balances.data?.[USDC.address.toLowerCase()];
  const tokenBalance = balances.data?.[token.address.toLowerCase()];
  const input = tryParse(amount, side === 'buy' ? 6 : 18);
  const quote = useQuery(
    input ? `quote:${side}:${token.address}:${input}` : null,
    async () => {
      if (side === 'buy') {
        const [out, charged] = await client.readContract({
          address: deployments.launch!,
          abi: launchAbi,
          functionName: 'quoteBuy',
          args: [token.address, input],
        });
        return { out, charged };
      }
      const out = await client.readContract({
        address: deployments.launch!,
        abi: launchAbi,
        functionName: 'quoteSell',
        args: [token.address, input],
      });
      return { out, charged: input };
    },
    6_000,
  );
  const q = quote.data;
  const balance = side === 'buy' ? usdcBalance : tokenBalance;
  const insufficient = balance !== undefined && input > balance;
  const min = q ? withSlippage(q.out, slippage) : 0n;
  const request =
    q && q.out > 0n
      ? side === 'buy'
        ? {
            address: deployments.launch!,
            abi: launchAbi,
            functionName: 'buy',
            args: [token.address, input, min, deadline()],
          }
        : {
            address: deployments.launch!,
            abi: launchAbi,
            functionName: 'sell',
            args: [token.address, input, min, deadline()],
          }
      : undefined;
  const presets =
    side === 'buy'
      ? ['1', '5', '10', '25'].map((v) => ({ label: `$${v}`, value: v }))
      : [0.25, 0.5, 1].map((f) => ({
          label: f === 1 ? 'Max' : `${f * 100}%`,
          value: tokenBalance ? formatUnits(f === 1 ? tokenBalance : (tokenBalance * BigInt(f * 100)) / 100n, 18) : '',
        }));
  return (
    <section className="card trade-panel" aria-label={`Trade ${token.symbol}`}>
      <div className="tabs buy-sell" role="tablist" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            data-side={s}
            aria-selected={side === s}
            onClick={() => {
              setSide(s);
              setAmount('');
            }}
          >
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>
      <AmountBox
        label={side === 'buy' ? 'You pay' : 'You sell'}
        value={amount}
        onChange={setAmount}
        decimals={side === 'buy' ? 6 : 18}
        balance={balance}
        onMax={balance ? () => setAmount(formatUnits(balance, side === 'buy' ? 6 : 18)) : undefined}
        token={
          <span className="token-tag">
            {side === 'buy' ? <UsdcMark /> : <Avatar seed={token.address} size={24} round />}
            {side === 'buy' ? 'USDC' : token.symbol}
          </span>
        }
      />
      <div className="presets">
        {presets.map((p) => (
          <button key={p.label} onClick={() => setAmount(p.value)} disabled={!p.value}>
            {p.label}
          </button>
        ))}
      </div>
      <dl className="kv">
        <div>
          <dt>You receive</dt>
          <dd>
            {quote.loading ? '…' : q ? `${formatAmount(q.out, side === 'buy' ? 18 : 6, 4)} ${side === 'buy' ? token.symbol : 'USDC'}` : '—'}
          </dd>
        </div>
        <div>
          <dt>Minimum after slippage</dt>
          <dd>{q ? `${formatAmount(min, side === 'buy' ? 18 : 6, 4)}` : '—'}</dd>
        </div>
        {side === 'buy' && q && q.charged < input && (
          <div>
            <dt>Charged (curve sells out)</dt>
            <dd>{formatAmount(q.charged, 6)} USDC</dd>
          </div>
        )}
        <div>
          <dt>Fee</dt>
          <dd>1%</dd>
        </div>
        <div>
          <dt>Slippage</dt>
          <dd>
            <span className="tabs" style={{ padding: 2 }}>
              {[100, 200, 500].map((b) => (
                <button key={b} style={{ height: 22, padding: '0 8px', fontSize: 11.5 }} aria-pressed={slippage === b} onClick={() => setSlippage(b)}>
                  {b / 100}%
                </button>
              ))}
            </span>
          </dd>
        </div>
      </dl>
      {quote.error && <p className="down" style={{ fontSize: 13 }}>{quote.error}</p>}
      <ActionButton
        label={side === 'buy' ? `Buy ${token.symbol}` : `Sell ${token.symbol}`}
        tone={side === 'buy' ? 'primary' : 'sell'}
        onConnect={openConnect}
        request={request}
        disabledReason={!input ? 'Enter an amount' : insufficient ? `Insufficient ${side === 'buy' ? 'USDC' : token.symbol}` : !q ? 'Fetching quote…' : undefined}
        approve={side === 'buy' ? { token: USDC, spender: deployments.launch!, amount: input } : undefined}
        onDone={() => setAmount('')}
      />
      {side === 'buy' && usdcBalance === 0n && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          Need test USDC?{' '}
          <a className="link" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
            Circle faucet
          </a>{' '}
          — on Arc it also pays your gas.
        </p>
      )}
    </section>
  );
}

export const UsdcMark = () => (
  <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="16" fill="#2775ca" />
    <path
      fill="#fff"
      d="M20.2 18.4c0-2.2-1.3-3-4-3.3-1.9-.3-2.3-.8-2.3-1.6s.6-1.4 1.9-1.4c1.1 0 1.7.4 2 1.3.1.2.2.3.4.3h1c.3 0 .4-.2.4-.4-.3-1.3-1.3-2.3-2.7-2.5V9.3c0-.2-.2-.4-.5-.4h-.9c-.2 0-.4.2-.4.4v1.5c-1.8.3-2.9 1.5-2.9 3 0 2.1 1.3 2.9 3.9 3.2 1.8.3 2.4.7 2.4 1.7s-.9 1.6-2.1 1.6c-1.6 0-2.2-.7-2.4-1.6 0-.2-.2-.3-.4-.3h-1c-.3 0-.4.2-.4.4.3 1.5 1.2 2.5 3.1 2.8v1.5c0 .2.2.4.5.4h.9c.2 0 .4-.2.4-.4v-1.5c1.8-.3 3-1.6 3-3.2z"
    />
  </svg>
);

function PriceChart({ trades, current }: { trades?: FeedTrade[]; current: number }) {
  const points = useMemo(() => {
    const list = [...(trades ?? [])].reverse().map((t) => ({ t: t.time, p: tradePrice(t.quoteAmount, t.tokenAmount), buy: t.isBuy }));
    if (list.length) list.push({ t: Math.max(Date.now() / 1000, list.at(-1)!.t), p: current, buy: true });
    return list;
  }, [trades, current]);
  if (!trades) return <Skeleton h={300} />;
  if (points.length < 2)
    return (
      <div className="chart" style={{ display: 'grid', placeItems: 'center' }}>
        <p className="muted">The chart starts with the first trade.</p>
      </div>
    );
  const W = 800,
    H = 300,
    pad = { l: 0, r: 0, t: 16, b: 16 };
  const prices = points.map((p) => p.p);
  let lo = Math.min(...prices),
    hi = Math.max(...prices);
  if (hi === lo) (hi *= 1.05), (lo *= 0.95);
  const span = hi - lo;
  hi += span * 0.08;
  lo -= span * 0.08;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`;
  const up = points.at(-1)!.p >= points[0].p;
  const color = up ? 'var(--buy)' : 'var(--sell)';
  const ticks = [hi - (hi - lo) * 0.1, (hi + lo) / 2, lo + (hi - lo) * 0.1];
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price history over ${points.length - 1} trades`}>
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#chart-fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {ticks.map((t) => (
        <span key={t} className="chart-label mono" style={{ top: `${(y(t) / H) * 100}%` }}>
          {price(t)}
        </span>
      ))}
    </div>
  );
}

function TradesTable({ trades, loading, symbol }: { trades?: FeedTrade[]; loading: boolean; symbol: string }) {
  const { toggle, isFollowing } = useFollows();
  return (
    <section className="card" aria-label="Trades">
      <div className="card-head">
        <h2>Trades</h2>
      </div>
      {loading ? (
        <div style={{ padding: 16 }}>
          <Skeleton h={120} />
        </div>
      ) : trades?.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Trader</th>
                <th>Side</th>
                <th className="r">USDC</th>
                <th className="r">{symbol}</th>
                <th className="r">Price</th>
                <th className="r">Age</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 60).map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Avatar seed={t.trader} size={20} round />
                      <AddressLink address={t.trader}>{shortAddress(t.trader)}</AddressLink>
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24 }}
                        onClick={() => toggle(t.trader)}
                        aria-label={isFollowing(t.trader) ? `Unfollow ${t.trader}` : `Follow ${t.trader}`}
                      >
                        {isFollowing(t.trader) ? <UserCheck size={13} color="var(--accent)" /> : <UserPlus size={13} />}
                      </button>
                    </span>
                  </td>
                  <td className={t.isBuy ? 'up' : 'down'}>{t.isBuy ? 'Buy' : 'Sell'}</td>
                  <td className="r mono">{formatAmount(t.quoteAmount, 6, 2)}</td>
                  <td className="r mono">{compact(Number(formatUnits(t.tokenAmount, 18)))}</td>
                  <td className="r mono">{price(tradePrice(t.quoteAmount, t.tokenAmount))}</td>
                  <td className="r muted">{timeAgo(t.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No trades yet">Be the first buyer on the curve.</Empty>
      )}
    </section>
  );
}

function YourPosition({ token, symbol, priceNow }: { token: Address; symbol: string; priceNow: number }) {
  const { address } = useWallet();
  const positions = usePositions(address);
  const balance = useQuery(address ? `bal:${address}:${token}` : null, () =>
    client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address!] }),
  );
  const p = positions.data?.find((x) => x.token.toLowerCase() === token.toLowerCase());
  if (!address || !p) return null;
  const held = Number(formatUnits(balance.data ?? p.balance, 18));
  const value = held * priceNow;
  const pnl = Number(p.received) / 1e6 + value - Number(p.spent) / 1e6;
  return (
    <div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ fontSize: 15 }}>Your position</h3>
      <dl className="kv">
        <div>
          <dt>Holding</dt>
          <dd>
            {compact(held)} {symbol}
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{usd(value)}</dd>
        </div>
        <div>
          <dt>Spent / received</dt>
          <dd>
            {usd(Number(p.spent) / 1e6)} / {usd(Number(p.received) / 1e6)}
          </dd>
        </div>
        <div>
          <dt>P&amp;L</dt>
          <dd className={pnl >= 0 ? 'up' : 'down'}>
            {pnl >= 0 ? '+' : ''}
            {usd(pnl)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
