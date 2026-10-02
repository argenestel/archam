import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Crown, Flame, Rocket, Search, Sparkles, UserCheck, UserPlus } from 'lucide-react';
import { formatUnits } from 'viem';
import { Avatar, Empty, Notice, Progress, Skeleton } from '../components/ui';
import { activeChain } from '../lib/arc';
import { deployments, graduationQuote } from '../lib/contracts';
import { useFeed, useLaunches, type FeedTrade, type Launch } from '../lib/data';
import { compact, pct, shortAddress, timeAgo, usd } from '../lib/format';
import { href } from '../lib/router';
import { useFollows } from '../lib/social';

type Sort = 'live' | 'top' | 'new' | 'graduating' | 'graduated';
const sorts: { id: Sort; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'top', label: 'Top' },
  { id: 'new', label: 'New' },
  { id: 'graduating', label: 'Graduating' },
  { id: 'graduated', label: 'Graduated' },
];

export default function Discover() {
  const launches = useLaunches();
  const [sort, setSort] = useState<Sort>('live');
  const [query, setQuery] = useState('');
  if (!deployments.launch)
    return (
      <div className="card">
        <Empty title={`Launches are not live on ${activeChain.name} yet`}>
          Orbit's launch contracts have not been deployed to this network. Swap and lending integrations appear
          here once a reviewed deployment is recorded.
        </Empty>
      </div>
    );
  const list = launches.data ?? [];
  const king = [...list].filter((l) => !l.graduated).sort((a, b) => b.progress - a.progress)[0];
  const q = query.trim().toLowerCase();
  const shown = list
    .filter((l) => !q || l.name.toLowerCase().includes(q) || l.symbol.toLowerCase().includes(q) || l.address.toLowerCase() === q)
    .filter((l) => (sort === 'graduated' ? l.graduated : sort === 'graduating' ? !l.graduated : true))
    .sort((a, b) =>
      sort === 'top'
        ? b.marketCap - a.marketCap
        : sort === 'new'
          ? b.createdAt - a.createdAt
          : sort === 'graduating'
            ? b.progress - a.progress
            : b.lastTradeAt - a.lastTradeAt || b.createdAt - a.createdAt,
    );
  return (
    <div className="discover">
      <div className="discover-main">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>What's launching on Arc</h1>
            <p>
              Fair-launch tokens priced on a bonding curve in USDC. At {usd(Number(graduationQuote) / 1e6, 0)} raised,
              liquidity moves to Uniswap&nbsp;V2 and the LP is burned.
            </p>
          </div>
          <a className="btn btn-primary" href="#/create">
            <Rocket size={16} /> Launch a token
          </a>
        </div>
        {launches.error && !launches.data && <Notice tone="error">{launches.error}</Notice>}
        {king ? <KingOfTheOrbit launch={king} /> : launches.loading && <Skeleton h={150} />}
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Sort launches">
            {sorts.map((s) => (
              <button key={s.id} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} />
            <span className="sr-only">Search launches</span>
            <input placeholder="Search name, symbol, address" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        {launches.loading ? (
          <div className="token-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} h={190} />
            ))}
          </div>
        ) : shown.length ? (
          <div className="token-grid">
            {shown.map((l) => (
              <TokenCard key={l.address} launch={l} />
            ))}
          </div>
        ) : (
          <div className="card">
            <Empty
              title={q ? 'No launches match' : 'Nothing here yet'}
              action={
                <a className="btn btn-primary" href="#/create">
                  Be first — launch a token
                </a>
              }
            />
          </div>
        )}
      </div>
      <LiveFeed launches={list} />
    </div>
  );
}

function KingOfTheOrbit({ launch: l }: { launch: Launch }) {
  return (
    <a className="card koth" href={href({ page: 'token', address: l.address })}>
      <Avatar seed={l.address} size={84} />
      <div className="koth-meta">
        <span className="crown eyebrow">
          <Crown size={13} /> King of the Orbit
        </span>
        <h2>
          {l.name} <span className="muted" style={{ fontSize: 16 }}>${l.symbol}</span>
        </h2>
        <div className="koth-metrics">
          <Metric label="Market cap" value={usd(l.marketCap)} />
          <Metric label="Volume" value={usd(Number(l.volume) / 1e6)} />
          <Metric label="Trades" value={compact(l.trades, 0)} />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="row between" style={{ fontSize: 12.5 }}>
            <span className="muted">Bonding curve</span>
            <span className="mono">{pct(l.progress)}</span>
          </div>
          <Progress value={l.progress} gold label={`${l.symbol} bonding curve progress`} />
        </div>
      </div>
      <span className="btn btn-primary koth-cta">
        <Flame size={16} /> Trade
      </span>
    </a>
  );
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="stat">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

function TokenCard({ launch: l }: { launch: Launch }) {
  const [flash, setFlash] = useState(false);
  const last = useRef(l.trades);
  useEffect(() => {
    if (l.trades !== last.current) {
      last.current = l.trades;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
  }, [l.trades]);
  return (
    <a className={`card token-card${flash ? ' flash' : ''}`} href={href({ page: 'token', address: l.address })}>
      <div className="token-card-top">
        <Avatar seed={l.address} size={48} />
        <div className="grow">
          <div className="token-name">{l.name}</div>
          <div className="token-sym">
            ${l.symbol} · by <span className="mono">{shortAddress(l.creator)}</span>
          </div>
        </div>
        {l.graduated ? (
          <span className="chip gold">
            <Sparkles size={11} /> Graduated
          </span>
        ) : (
          l.createdAt > Date.now() / 1000 - 3600 && <span className="chip accent">New</span>
        )}
      </div>
      <p className="token-desc">{l.description || 'No description.'}</p>
      <div style={{ display: 'grid', gap: 7 }}>
        <div className="row between" style={{ fontSize: 13 }}>
          <span>
            <span className="muted">MC </span>
            <b className="mono">{usd(l.marketCap)}</b>
          </span>
          <span className="mono muted">{pct(l.progress, 0)}</span>
        </div>
        <Progress value={l.progress} gold={l.graduated} label={`${l.symbol} bonding curve progress`} />
      </div>
      <div className="token-foot">
        <span>{l.trades} trades</span>
        <span>{l.lastTradeAt ? `last trade ${timeAgo(l.lastTradeAt)} ago` : `created ${timeAgo(l.createdAt)} ago`}</span>
      </div>
    </a>
  );
}

function LiveFeed({ launches }: { launches: Launch[] }) {
  const feed = useFeed(undefined, 50);
  const { follows, toggle, isFollowing } = useFollows();
  const [tab, setTab] = useState<'all' | 'following'>('all');
  const tokens = useMemo(() => new Map(launches.map((l) => [l.address.toLowerCase(), l])), [launches]);
  const items = (feed.data ?? []).filter((t) => tab === 'all' || follows.includes(t.trader.toLowerCase()));
  return (
    <aside className="card feed" aria-label="Live trades">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <span className="net-pill" style={{ height: 'auto', border: 0, padding: 0 }}>
            <i />
          </span>
          Live trades
        </h2>
        <div className="tabs" role="group" aria-label="Feed filter">
          <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
            All
          </button>
          <button aria-pressed={tab === 'following'} onClick={() => setTab('following')}>
            Following{follows.length ? ` ${follows.length}` : ''}
          </button>
        </div>
      </div>
      {feed.loading ? (
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={34} />
          ))}
        </div>
      ) : items.length ? (
        <ul className="feed-list">
          {items.map((t) => (
            <FeedRow
              key={t.id}
              trade={t}
              launch={tokens.get(t.token.toLowerCase())}
              following={isFollowing(t.trader)}
              toggle={() => toggle(t.trader)}
            />
          ))}
        </ul>
      ) : (
        <Empty title={tab === 'following' ? 'No trades from people you follow' : 'No trades yet'}>
          {tab === 'following' ? 'Follow traders from the feed or the leaderboard to see their moves here.' : null}
        </Empty>
      )}
    </aside>
  );
}

export function FeedRow({
  trade: t,
  launch,
  following,
  toggle,
}: {
  trade: FeedTrade;
  launch?: Launch;
  following: boolean;
  toggle: () => void;
}) {
  const amount = Number(formatUnits(t.quoteAmount, 6));
  const copyAmount = Math.min(Math.max(amount, 0.1), 1000).toFixed(2);
  return (
    <li className="feed-item">
      <Avatar seed={t.trader} size={30} round />
      <div style={{ minWidth: 0 }}>
        <div className="who">
          <span className="mono">{shortAddress(t.trader)}</span>{' '}
          <span className={t.isBuy ? 'up' : 'down'}>{t.isBuy ? 'bought' : 'sold'}</span>{' '}
          <a href={href({ page: 'token', address: t.token })}>
            <b>${launch?.symbol ?? '…'}</b>
          </a>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button
            className="btn-quiet"
            style={{ fontSize: 11.5, padding: '2px 4px 2px 0' }}
            onClick={toggle}
            aria-label={following ? `Unfollow ${t.trader}` : `Follow ${t.trader}`}
          >
            {following ? <UserCheck size={12} /> : <UserPlus size={12} />} {following ? 'Following' : 'Follow'}
          </button>
          {t.isBuy && launch && !launch.graduated && (
            <a
              className="btn-quiet"
              style={{ fontSize: 11.5, padding: '2px 4px' }}
              href={href({ page: 'token', address: t.token, buy: copyAmount })}
              aria-label={`Copy this buy of ${launch.symbol}`}
            >
              <Copy size={11} /> Copy
            </a>
          )}
        </div>
      </div>
      <div className="amt">
        <span className={`mono ${t.isBuy ? 'up' : 'down'}`}>{usd(amount)}</span>
        <span className="faint" style={{ fontSize: 11.5 }}>
          {timeAgo(t.time)}
        </span>
      </div>
    </li>
  );
}
