import { useMemo, useState } from 'react';
import { TraderIdentity } from '../components/Media';
import { UserCheck, UserPlus } from 'lucide-react';
import { Empty, Notice, Skeleton } from '../components/ui';
import { useLaunches, useTraders } from '../lib/data';
import { compact, usd } from '../lib/format';
import { useFollows } from '../lib/social';
import { useWallet } from '../lib/wallet';

type By = 'pnl' | 'volume' | 'points';

export default function Leaders() {
  const launches = useLaunches();
  const prices = useMemo(
    () =>
      launches.data
        ? new Map(launches.data.map((l) => [l.address.toLowerCase(), l.price]))
        : undefined,
    [launches.data],
  );
  const traders = useTraders(prices);
  const { address } = useWallet();
  const { toggle, isFollowing } = useFollows();
  const [by, setBy] = useState<By>('pnl');
  const rows = [...(traders.data ?? [])]
    .filter((t) => t.trades > 0 || t.launches > 0)
    .sort((a, b) =>
      by === 'pnl'
        ? (b.pnl ?? 0) - (a.pnl ?? 0)
        : by === 'volume'
          ? b.volume > a.volume
            ? 1
            : -1
          : b.points - a.points,
    );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <p>
            Every number here is recomputed from launch-contract state: no off-chain database,
            nothing to edit. P&amp;L marks open positions to the current curve or pool price.
          </p>
        </div>
        <div className="tabs" role="group" aria-label="Rank by">
          {(
            [
              ['pnl', 'P&L'],
              ['volume', 'Volume'],
              ['points', 'Points'],
            ] as [By, string][]
          ).map(([id, label]) => (
            <button key={id} aria-pressed={by === id} onClick={() => setBy(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {traders.error && !traders.data && <Notice tone="error">{traders.error}</Notice>}
      <section className="card">
        {traders.loading || !traders.data ? (
          <div style={{ padding: 20, display: 'grid', gap: 10 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} h={36} />
            ))}
          </div>
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Trader</th>
                  <th className="r">P&amp;L</th>
                  <th className="r">Volume</th>
                  <th className="r">Trades</th>
                  <th className="r">Launches</th>
                  <th className="r">Points</th>
                  <th className="r">
                    <span className="sr-only">Follow</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => {
                  const me = address?.toLowerCase() === t.address.toLowerCase();
                  return (
                    <tr
                      key={t.address}
                      style={me ? { background: 'var(--accent-soft)' } : undefined}
                    >
                      <td className={`rank${i < 3 ? ' top' : ''}`}>{i + 1}</td>
                      <td>
                        <span className="row" style={{ gap: 10 }}>
                          <TraderIdentity address={t.address} size={26} />
                          {me && <span className="chip accent">You</span>}
                        </span>
                      </td>
                      <td className={`r mono ${(t.pnl ?? 0) >= 0 ? 'up' : 'down'}`}>
                        {(t.pnl ?? 0) >= 0 ? '+' : ''}
                        {usd(t.pnl ?? 0)}
                      </td>
                      <td className="r mono">{usd(Number(t.volume) / 1e6)}</td>
                      <td className="r mono">{t.trades}</td>
                      <td className="r mono">{t.launches}</td>
                      <td className="r mono">{compact(t.points, 0)}</td>
                      <td className="r">
                        {!me && (
                          <button
                            className={`btn btn-sm ${isFollowing(t.address) ? 'btn-ghost' : 'btn-quiet'}`}
                            onClick={() => toggle(t.address)}
                            aria-label={
                              isFollowing(t.address)
                                ? `Unfollow ${t.address}`
                                : `Follow ${t.address}`
                            }
                          >
                            {isFollowing(t.address) ? (
                              <UserCheck size={14} />
                            ) : (
                              <UserPlus size={14} />
                            )}
                            {isFollowing(t.address) ? 'Following' : 'Follow'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No traders yet"
            action={
              <a className="btn btn-primary" href="#/">
                Make the first trade
              </a>
            }
          />
        )}
      </section>
      <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
        Points: 1 per USDC traded. Trade count and launch count earn nothing, so splitting, spamming
        launches or wash-trading only costs fees. Points have no monetary value and are not a
        promise of any reward. Following is a private watchlist stored in this browser.
      </p>
    </>
  );
}
