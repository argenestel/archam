import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, HelpCircle, XCircle } from 'lucide-react';
import { formatUnits } from 'viem';
import { Avatar, Empty, Skeleton, TxLink } from '../components/ui';
import { USDC, baseTokens, lendingMarkets } from '../lib/contracts';
import { useBalances, useLaunches, useMarket, usePositions, useTraderStats } from '../lib/data';
import { compact, formatAmount, shortAddress, timeAgo, usd } from '../lib/format';
import { level } from '../lib/math';
import { readTransactions, type LocalTransaction } from '../lib/transactions';
import { useTx } from '../lib/tx';
import { openConnect, useWallet } from '../lib/wallet';
import { UsdcMark } from './TokenPage';
import { isTestnet } from '../lib/arc';
import Earn from './Earn';
import Borrow from './Borrow';

export default function Portfolio() {
  const { address, gas } = useWallet();
  if (!address)
    return (
      <div className="card">
        <Empty
          title="Connect to see your portfolio"
          action={
            <button className="btn btn-primary" onClick={openConnect}>
              Connect wallet
            </button>
          }
        >
          {isTestnet
            ? 'Balances, launch positions, lending and points — read straight from Arc.'
            : 'Wallet balances, vault positions, provider-indexed loans and local transaction receipts.'}
        </Empty>
      </div>
    );
  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Avatar seed={address} size={52} round />
          <div>
            <h1 className="mono" style={{ fontSize: 26 }}>
              {shortAddress(address)}
            </h1>
            <p className="muted" style={{ marginTop: 2 }}>
              Gas{' '}
              <span className="mono">
                {gas === undefined ? '…' : compact(Number(formatUnits(gas, 18)), 4)} USDC
              </span>
            </p>
          </div>
        </div>
      </div>
      <a className="btn btn-ghost" href="#/profile" style={{ marginBottom: 20 }}>
        Edit IPFS profile
      </a>
      {!isTestnet ? (
        <div className="stack">
          <Balances />
          <Earn />
          <Borrow />
          <Activity />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          <div className="grid-2">
            <PointsCard />
            <Balances />
          </div>
          <LaunchPositions />
          <div className="grid-2">
            <LendingSummary />
            <Activity />
          </div>
        </div>
      )}
    </>
  );
}

function PointsCard() {
  const { address } = useWallet();
  const stats = useTraderStats(address);
  const s = stats.data;
  const lv = level(s?.points ?? 0);
  return (
    <section className="card card-pad" style={{ display: 'grid', gap: 16 }}>
      <div className="row between">
        <h3 style={{ fontSize: 15 }}>Mofu points</h3>
        <a className="link" href="#/leaders" style={{ fontSize: 13 }}>
          Leaderboard
        </a>
      </div>
      {s ? (
        <div className="row" style={{ gap: 20 }}>
          <div
            className="level-ring"
            style={{ ['--p' as string]: Math.round(lv.progress * 100) }}
            aria-label={`Level ${lv.level}`}
          >
            {lv.level}
          </div>
          <dl className="stats grow">
            <div className="stat">
              <dt>Points</dt>
              <dd className="up">{compact(s.points, 0)}</dd>
            </div>
            <div className="stat">
              <dt>Trades</dt>
              <dd>{s.trades}</dd>
            </div>
            <div className="stat">
              <dt>Volume</dt>
              <dd>{usd(Number(s.volume) / 1e6)}</dd>
            </div>
            <div className="stat">
              <dt>Launches</dt>
              <dd>{s.launches}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <Skeleton h={88} />
      )}
      <p className="faint" style={{ fontSize: 12 }}>
        {compact(Math.max(0, lv.next - (s?.points ?? 0)), 0)} points to level {lv.level + 1}.
        Derived from confirmed on-chain trades only; no monetary value.
      </p>
    </section>
  );
}

function Balances() {
  const { address } = useWallet();
  const balances = useBalances(address, baseTokens);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Wallet</h2>
        <a className="link" href="#/swap" style={{ fontSize: 13 }}>
          {isTestnet ? 'Get test funds' : 'Swap assets'}
        </a>
      </div>
      <ul className="list">
        {baseTokens.map((t) => (
          <li key={t.address}>
            {t === USDC ? <UsdcMark /> : <Avatar seed={t.address} size={24} round />}
            <span className="grow">
              <b>{t.symbol}</b>{' '}
              <span className="muted" style={{ fontSize: 12.5 }}>
                {t.name}
              </span>
            </span>
            <span className="mono">
              {balances.data
                ? formatAmount(balances.data[t.address.toLowerCase()] ?? 0n, t.decimals, 4)
                : '…'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LaunchPositions() {
  const { address } = useWallet();
  const positions = usePositions(address);
  const launches = useLaunches();
  const byToken = new Map(launches.data?.map((l) => [l.address.toLowerCase(), l]) ?? []);
  const rows = (positions.data ?? []).map((p) => {
    const l = byToken.get(p.token.toLowerCase());
    const value = (l?.price ?? 0) * Number(formatUnits(p.balance, 18));
    return {
      ...p,
      launch: l,
      value,
      pnl: Number(p.received) / 1e6 + value - Number(p.spent) / 1e6,
    };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  const pnl = rows.reduce((s, r) => s + r.pnl, 0);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Launch positions</h2>
        {rows.length > 0 && (
          <span className="mono" style={{ fontSize: 13 }}>
            {usd(total)} worth,{' '}
            <span className={pnl >= 0 ? 'up' : 'down'}>
              {pnl >= 0 ? '+' : ''}
              {usd(pnl)}
            </span>
          </span>
        )}
      </div>
      {positions.loading ? (
        <div style={{ padding: 20 }}>
          <Skeleton h={80} />
        </div>
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Token</th>
                <th className="r">Holding</th>
                <th className="r">Value</th>
                <th className="r">Spent</th>
                <th className="r">Received</th>
                <th className="r">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.token}
                  onClick={() => (window.location.hash = `#/token/${r.token}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <a className="row" style={{ gap: 10 }} href={`#/token/${r.token}`}>
                      <Avatar seed={r.token} size={26} />
                      <b>${r.launch?.symbol ?? '…'}</b>
                    </a>
                  </td>
                  <td className="r mono">{compact(Number(formatUnits(r.balance, 18)))}</td>
                  <td className="r mono">{usd(r.value)}</td>
                  <td className="r mono">{usd(Number(r.spent) / 1e6)}</td>
                  <td className="r mono">{usd(Number(r.received) / 1e6)}</td>
                  <td className={`r mono ${r.pnl >= 0 ? 'up' : 'down'}`}>
                    {r.pnl >= 0 ? '+' : ''}
                    {usd(r.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No launch trades yet"
          action={
            <a className="btn btn-ghost" href="#/">
              Discover launches
            </a>
          }
        />
      )}
    </section>
  );
}

function LendingSummary() {
  const { address } = useWallet();
  const market = lendingMarkets[0];
  const m = useMarket(market?.id, market?.params, address);
  if (!market) return null;
  const d = m.data;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Lending</h2>
        <a className="link" href="#/lend" style={{ fontSize: 13 }}>
          Manage
        </a>
      </div>
      <div className="card-pad">
        {d ? (
          <dl className="kv">
            <div>
              <dt>Supplied</dt>
              <dd>{formatAmount(d.supplied, 6, 2)} tUSDC</dd>
            </div>
            <div>
              <dt>Collateral</dt>
              <dd>{formatAmount(d.collateral, 18, 4)} tETH</dd>
            </div>
            <div>
              <dt>Borrowed</dt>
              <dd>{formatAmount(d.borrowed, 6, 2)} tUSDC</dd>
            </div>
            <div>
              <dt>Supply APY</dt>
              <dd className="up">{(d.supplyApy * 100).toFixed(2)}%</dd>
            </div>
          </dl>
        ) : (
          <Skeleton h={90} />
        )}
      </div>
    </section>
  );
}

function Activity() {
  const { address } = useWallet();
  const { recheck, unresolved } = useTx();
  const [items, setItems] = useState<LocalTransaction[]>([]);
  useEffect(() => {
    const load = () =>
      setItems(
        readTransactions().filter((t) => t.account.toLowerCase() === address?.toLowerCase()),
      );
    load();
    window.addEventListener('orbit:transactions', load);
    return () => window.removeEventListener('orbit:transactions', load);
  }, [address]);
  const icon = (s: LocalTransaction['status']) =>
    s === 'confirmed' ? (
      <CheckCircle2 size={16} color="var(--accent)" />
    ) : s === 'reverted' ? (
      <XCircle size={16} color="var(--sell)" />
    ) : s === 'pending' ? (
      <Clock size={16} color="var(--info)" />
    ) : (
      <HelpCircle size={16} color="var(--gold)" />
    );
  return (
    <section className="card">
      <div className="card-head">
        <h2>Recent activity</h2>
        {unresolved && (
          <button className="btn btn-ghost btn-sm" onClick={recheck}>
            Check pending
          </button>
        )}
      </div>
      {items.length ? (
        <ul className="list">
          {items.slice(0, 12).map((t) => (
            <li key={t.hash}>
              {icon(t.status)}
              <span className="grow">
                {t.label}
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {t.status[0].toUpperCase() + t.status.slice(1)} {timeAgo(t.time / 1000)} ago
                </span>
              </span>
              <TxLink hash={t.hash}>Explorer</TxLink>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No transactions from this browser yet" />
      )}
    </section>
  );
}
