import { useMemo, useState } from 'react';
import { Copy, Search, UserCheck, UserPlus } from 'lucide-react';
import { formatUnits } from 'viem';
import { Curve } from '../components/Curve';
import { Avatar, Empty, Notice, Skeleton } from '../components/ui';
import { activeChain } from '../lib/arc';
import { deployments, graduationQuote } from '../lib/contracts';
import { useFeed, useLaunches, type FeedTrade, type Launch } from '../lib/data';
import { pct, shortAddress, timeAgo, usd } from '../lib/format';
import { href } from '../lib/router';
import { useFollows } from '../lib/social';

type Sort = 'active' | 'new' | 'cap' | 'close';
const sorts: { id: Sort; label: string }[] = [
  { id: 'active', label: 'Recently traded' },
  { id: 'close', label: 'Closest to graduating' },
  { id: 'cap', label: 'Market cap' },
  { id: 'new', label: 'Newest' },
];
const GRAD = Number(graduationQuote) / 1e6;

export default function Discover() {
  const launches = useLaunches();
  const [sort, setSort] = useState<Sort>('active');
  const [query, setQuery] = useState('');
  if (!deployments.launch)
    return (
      <div className="card">
        <Empty title={`Launches aren’t open on ${activeChain.name} yet`}>
          The launch contract hasn’t been deployed to this network. Swap and Lend work with the protocols already
          running here.
        </Empty>
      </div>
    );
  const list = launches.data ?? [];
  const leader = [...list].filter((l) => !l.graduated).sort((a, b) => b.progress - a.progress)[0];
  const q = query.trim().toLowerCase();
  const shown = list
    .filter((l) => !q || `${l.name} ${l.symbol} ${l.address}`.toLowerCase().includes(q))
    .filter((l) => sort !== 'close' || !l.graduated)
    .sort((a, b) =>
      sort === 'cap'
        ? b.marketCap - a.marketCap
        : sort === 'new'
          ? b.createdAt - a.createdAt
          : sort === 'close'
            ? b.progress - a.progress
            : b.lastTradeAt - a.lastTradeAt || b.createdAt - a.createdAt,
    );
  return (
    <div className="discover">
      <div className="discover-main">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Launches</h1>
            <p>
              Every token starts on the same price curve, paid in USDC. When {usd(GRAD, 0)} has gone in, the curve
              closes and its liquidity moves to Uniswap, locked for good.
            </p>
          </div>
        </div>
        {launches.error && !launches.data && <Notice tone="error">{launches.error}</Notice>}
        {leader ? <Leader launch={leader} /> : launches.loading && <Skeleton h={300} />}
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
            <input placeholder="Name, ticker or address" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <section className="card" aria-label="All launches">
          {launches.loading ? (
            <div style={{ padding: 20, display: 'grid', gap: 12 }}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} h={36} />
              ))}
            </div>
          ) : shown.length ? (
            <ul className="launch-list">
              <li aria-hidden>
                <div className="launch-row launch-head">
                  <span />
                  <span>Token</span>
                  <span className="hide-sm">Curve</span>
                  <span className="r hide-sm">Market cap</span>
                  <span className="r">Last trade</span>
                </div>
              </li>
              {shown.map((l) => (
                <li key={l.address}>
                  <LaunchRow launch={l} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title={q ? `Nothing matches “${query}”` : 'No launches yet'}
              action={
                <a className="btn btn-primary" href="#/create">
                  Launch a token
                </a>
              }
            >
              {q ? 'Try a ticker or paste a token address.' : 'The first token launched here shows up at the top.'}
            </Empty>
          )}
        </section>
      </div>
      <TradeFeed launches={list} />
    </div>
  );
}

function Leader({ launch: l }: { launch: Launch }) {
  const left = Math.max(0, GRAD - Number(l.realQuote) / 1e6);
  return (
    <section className="card hero" aria-label={`${l.name}, closest to graduating`}>
      <div style={{ minWidth: 0 }}>
        <a className="hero-title" href={href({ page: 'token', address: l.address })}>
          <Avatar seed={l.address} size={40} />
          <div>
            <h2>{l.name}</h2>
            <span className="muted">${l.symbol}, closest to graduating</span>
          </div>
        </a>
        <Curve variant="hero" progress={l.progress} label={`${l.symbol} is ${pct(l.progress)} along its curve`} />
        <div className="hero-axis">
          <span>Launch price</span>
          <span>{pct(l.progress, 0)} sold</span>
          <span>Graduation</span>
        </div>
      </div>
      <div className="hero-side">
        <div>
          <div className="big">{usd(left)}</div>
          <p className="muted">more USDC graduates it</p>
        </div>
        <dl className="kv">
          <div>
            <dt>Market cap</dt>
            <dd>{usd(l.marketCap)}</dd>
          </div>
          <div>
            <dt>Traded</dt>
            <dd>{usd(Number(l.volume) / 1e6)}</dd>
          </div>
          <div>
            <dt>Trades</dt>
            <dd>{l.trades}</dd>
          </div>
        </dl>
        <a className="btn btn-primary" href={href({ page: 'token', address: l.address })}>
          Buy ${l.symbol}
        </a>
      </div>
    </section>
  );
}

function LaunchRow({ launch: l }: { launch: Launch }) {
  return (
    <a className="launch-row" href={href({ page: 'token', address: l.address })}>
      <Avatar seed={l.address} size={36} />
      <div style={{ minWidth: 0 }}>
        <div className="name">
          {l.name} <span className="muted" style={{ fontWeight: 400 }}>${l.symbol}</span>
        </div>
        <div className="sub">{l.description || `Launched by ${shortAddress(l.creator)}`}</div>
      </div>
      <div className="hide-sm">
        {l.graduated ? (
          <span className="chip gold">Graduated</span>
        ) : (
          <Curve progress={l.progress} label={`${pct(l.progress, 0)} along its curve`} />
        )}
      </div>
      <div className="r hide-sm">{usd(l.marketCap)}</div>
      <div className="r muted">{l.lastTradeAt ? `${timeAgo(l.lastTradeAt)} ago` : 'No trades'}</div>
    </a>
  );
}

function TradeFeed({ launches }: { launches: Launch[] }) {
  const feed = useFeed(undefined, 50);
  const { follows, toggle, isFollowing } = useFollows();
  const [tab, setTab] = useState<'all' | 'following'>('all');
  const tokens = useMemo(() => new Map(launches.map((l) => [l.address.toLowerCase(), l])), [launches]);
  const items = (feed.data ?? []).filter((t) => tab === 'all' || follows.includes(t.trader.toLowerCase()));
  return (
    <aside className="card feed" aria-label="Recent trades">
      <div className="card-head">
        <h2>Trades</h2>
        <div className="tabs" role="group" aria-label="Show trades from">
          <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
            Everyone
          </button>
          <button aria-pressed={tab === 'following'} onClick={() => setTab('following')}>
            Following
          </button>
        </div>
      </div>
      {feed.loading ? (
        <div style={{ padding: 18, display: 'grid', gap: 10 }}>
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
        <Empty title={tab === 'following' ? 'You’re not following anyone yet' : 'No trades yet'}>
          {tab === 'following'
            ? 'Follow a trader from this list or the leaderboard, and their trades show up here as they happen.'
            : 'Trades appear here the moment they confirm.'}
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
      <Avatar seed={t.trader} size={28} round />
      <div style={{ minWidth: 0 }}>
        <div className="who">
          {shortAddress(t.trader)} <span className={t.isBuy ? 'up' : 'down'}>{t.isBuy ? 'bought' : 'sold'}</span>{' '}
          <a href={href({ page: 'token', address: t.token })}>
            <b>${launch?.symbol ?? '…'}</b>
          </a>
        </div>
        <div className="actions">
          <button className="btn-quiet" onClick={toggle} aria-label={`${following ? 'Unfollow' : 'Follow'} ${t.trader}`}>
            {following ? <UserCheck size={13} /> : <UserPlus size={13} />}
            {following ? 'Following' : 'Follow'}
          </button>
          {t.isBuy && launch && !launch.graduated && (
            <a
              className="btn-quiet"
              href={href({ page: 'token', address: t.token, buy: copyAmount })}
              aria-label={`Copy this buy of ${launch.symbol}`}
            >
              <Copy size={12} /> Copy buy
            </a>
          )}
        </div>
      </div>
      <div className="amt">
        {usd(amount)}
        <span>{timeAgo(t.time)} ago</span>
      </div>
    </li>
  );
}
