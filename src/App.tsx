import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { arcTestnet } from './lib/arc';
import { useWallet } from './lib/useWallet';
import {
  demoQuote,
  initialDemo,
  loadDemo,
  STORAGE_KEY,
  tokens,
  usd,
  validAmount,
  type DemoState,
} from './lib/market';

const nav: { name: string; icon: LucideIcon }[] = [
  { name: 'Trade', icon: ArrowLeftRight },
  { name: 'Discover', icon: Compass },
  { name: 'Lend', icon: LayoutDashboard },
  { name: 'Portfolio', icon: Wallet },
  { name: 'Rewards', icon: Gift },
];
const pools = [
  {
    name: 'USDC / ETH',
    symbols: ['USDC', 'ETH'],
    type: 'Blue chip',
    tvl: '$2.84M',
    apr: '12.4%',
    volume: '$482.6K',
  },
  {
    name: 'USDC / EURC',
    symbols: ['USDC', 'EURC'],
    type: 'Stable pair',
    tvl: '$1.62M',
    apr: '5.8%',
    volume: '$218.2K',
  },
  {
    name: 'BTC / USDC',
    symbols: ['BTC', 'USDC'],
    type: 'Blue chip',
    tvl: '$980.4K',
    apr: '9.2%',
    volume: '$164.8K',
  },
];
const launches = [
  {
    id: 'nova',
    name: 'Nova Finance',
    ticker: 'NOVA',
    description: 'A new orbit for onchain yield.',
    color: '#ece7ff',
    mark: '✳',
    progress: 68,
    raised: '$136,000',
    goal: '$200,000',
    tag: 'DeFi',
  },
  {
    id: 'pulse',
    name: 'Pulse Network',
    ticker: 'PULSE',
    description: 'Payments that move at your speed.',
    color: '#e0f5ef',
    mark: 'ϟ',
    progress: 42,
    raised: '$63,000',
    goal: '$150,000',
    tag: 'Payments',
  },
  {
    id: 'aero',
    name: 'Aero Protocol',
    ticker: 'AERO',
    description: 'Real-world assets. Real possibilities.',
    color: '#fff0df',
    mark: '◈',
    progress: 85,
    raised: '$212,500',
    goal: '$250,000',
    tag: 'RWA',
  },
];
const chartLine = (timeframe: string) =>
  timeframe === '1H' || timeframe === '24H'
    ? 'M0 135 L20 125 L40 145 L60 132 L80 140 L100 115 L120 128 L140 104 L160 113 L180 90 L200 108 L220 78 L240 95 L260 83 L280 100 L300 73 L320 90 L340 50 L360 61 L380 45 L400 75 L420 54 L440 65 L460 40 L480 55 L500 30 L520 44 L540 25 L560 45 L580 34 L600 39 L620 25 L640 32'
    : 'M0 170 L18 167 L30 176 L44 155 L60 159 L73 163 L90 145 L106 159 L122 150 L140 156 L154 136 L170 140 L188 115 L200 119 L215 99 L230 116 L248 97 L260 109 L275 77 L288 89 L304 57 L320 63 L334 44 L348 66 L360 52 L374 76 L392 65 L404 89 L418 81 L436 113 L452 98 L468 110 L482 87 L500 98 L516 74 L528 82 L544 54 L558 64 L572 31 L588 43 L602 22 L616 38 L632 27 L640 32';
function TokenIcon({ symbol, small = false }: { symbol: string; small?: boolean }) {
  const t = tokens.find((t) => t.symbol === symbol)!;
  return (
    <span className={`token-icon ${small ? 'small' : ''}`} style={{ background: t.color }}>
      {t.mark}
    </span>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [page, setPage] = useState('Trade');
  const [mobileNav, setMobileNav] = useState(false);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [demo, setDemo] = useState<DemoState>(loadDemo);
  const [from, setFrom] = useState(tokens[0]);
  const [to, setTo] = useState(tokens[1]);
  const [amount, setAmount] = useState('100');
  const [tokenPicker, setTokenPicker] = useState<'from' | 'to' | null>(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<
    'settings' | 'wallet' | 'confirm' | 'pool' | 'lend' | 'launch' | null
  >(null);
  const [selectedPool, setSelectedPool] = useState(pools[0]);
  const [selectedLaunch, setSelectedLaunch] = useState(launches[0]);
  const [lendAction, setLendAction] = useState<'Supply' | 'Withdraw'>('Supply');
  const [actionAmount, setActionAmount] = useState('100');
  const [slippage, setSlippage] = useState(0.5);
  const [timeframe, setTimeframe] = useState('1W');
  const [toast, setToast] = useState('');
  const wallet = useWallet();
  const output = demoQuote(amount, from, to);
  const demoMode = mode === 'demo';
  const totalValue = tokens.reduce(
    (sum, t) => sum + demo.balances[t.symbol] * t.price,
    demo.supplied,
  );
  const level = Math.floor(demo.xp / 500) + 1;
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
    } catch {
      /* Demo continues in memory. */
    }
  }, [demo]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  function record(
    kind: string,
    detail: string,
    xp: number,
    update: (state: DemoState) => DemoState,
  ) {
    setDemo((s) => {
      const next = update(s);
      return {
        ...next,
        xp: s.xp + xp,
        activities: [
          { id: crypto.randomUUID(), kind, detail, xp, time: Date.now() },
          ...s.activities,
        ].slice(0, 50),
      };
    });
    setModal(null);
    setToast(`${kind} simulated · +${xp} demo XP`);
  }
  function swap() {
    if (!demoMode || !validAmount(amount) || Number(amount) > demo.balances[from.symbol]) return;
    record(
      'Swap',
      `${Number(amount)} ${from.symbol} → ${output.toFixed(6)} ${to.symbol}`,
      25,
      (s) => ({
        ...s,
        balances: {
          ...s.balances,
          [from.symbol]: s.balances[from.symbol] - Number(amount),
          [to.symbol]: s.balances[to.symbol] + output,
        },
      }),
    );
    setAmount('');
  }
  function lend() {
    const n = Number(actionAmount);
    if (
      !demoMode ||
      !validAmount(actionAmount) ||
      n > (lendAction === 'Supply' ? demo.balances.USDC : demo.supplied)
    )
      return;
    record(lendAction, `${n} USDC`, lendAction === 'Supply' ? 15 : 0, (s) => ({
      ...s,
      supplied: s.supplied + (lendAction === 'Supply' ? n : -n),
      balances: { ...s.balances, USDC: s.balances.USDC + (lendAction === 'Supply' ? -n : n) },
    }));
  }
  function joinLaunch() {
    const n = Number(actionAmount);
    if (
      !demoMode ||
      !validAmount(actionAmount) ||
      n > demo.balances.USDC ||
      demo.joined.includes(selectedLaunch.id)
    )
      return;
    record('Launch contribution', `${n} USDC · ${selectedLaunch.name}`, 50, (s) => ({
      ...s,
      balances: { ...s.balances, USDC: s.balances.USDC - n },
      joined: [...s.joined, selectedLaunch.id],
    }));
  }
  const liveNotice = (
    <div className="notice">
      <ShieldCheck size={18} />
      <span>
        Live execution is not enabled. No verified router, launchpad, or lending deployment is
        bundled. No approvals or transactions will be requested.
      </span>
    </div>
  );
  function openLend(action: 'Supply' | 'Withdraw') {
    setLendAction(action);
    setActionAmount('100');
    setModal('lend');
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('Trade');
          }}
        >
          <img src="/orbit.svg" alt="" />
          orbit<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR DEFI, IN ONE ORBIT</div>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? 'active' : ''}`}
              onClick={() => {
                setPage(name);
                setMobileNav(false);
              }}
            >
              <Icon size={20} />
              {name}
              {name === 'Rewards' && <span className="nav-new">NEW</span>}
              {page === name && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="xp-mini">
            <div className="xp-mini-icon">
              <Zap size={19} fill="currentColor" />
            </div>
            <div>
              <strong>Level {level} explorer</strong>
              <span>{demo.xp} demo XP earned</span>
            </div>
            <ArrowRight size={16} />
          </div>
          <div className="xp-track">
            <i style={{ width: `${(demo.xp % 500) / 5}%` }} />
          </div>
          <button className="sidebar-help" onClick={() => setModal('wallet')}>
            <CircleHelp size={18} /> Getting started <ArrowUpRight size={15} />
          </button>
          <div className="network-status">
            <span /> Arc testnet <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle menu"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <div className="mode-toggle" aria-label="Execution mode">
              <button className={demoMode ? 'selected' : ''} onClick={() => setMode('demo')}>
                Demo
              </button>
              <button className={!demoMode ? 'selected' : ''} onClick={() => setMode('live')}>
                Live
              </button>
            </div>
            <span className="chain-pill">
              <span className="arc-mark">a</span> Arc <ChevronDown size={13} />
            </span>
            <button className="connect-button" onClick={() => setModal('wallet')}>
              <Wallet size={16} />
              {wallet.address
                ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                : 'Connect wallet'}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> BUILT FOR ARC
              </div>
              <h1>
                {page === 'Trade'
                  ? 'Your next move starts here.'
                  : page === 'Discover'
                    ? 'Find your next opportunity.'
                    : page === 'Lend'
                      ? 'Put your assets to work.'
                      : page === 'Portfolio'
                        ? 'All your assets. One view.'
                        : 'Good habits. Great rewards.'}
              </h1>
              <p>
                {page === 'Trade'
                  ? 'Swap, earn, and explore. A simpler way to DeFi.'
                  : page === 'Discover'
                    ? 'Explore liquidity pools and projects taking off on Arc.'
                    : page === 'Lend'
                      ? 'Supply liquidity and explore borrowing, without the complexity.'
                      : page === 'Portfolio'
                        ? 'Keep track of every move in your orbit.'
                        : 'Make moves, earn XP, and grow your onchain journey.'}
              </p>
            </div>
            <div className="demo-label">
              <span /> {demoMode ? 'Demo workspace' : 'Live · read-only'}
              <small>
                {demoMode
                  ? 'Virtual funds. Real possibilities.'
                  : 'Arc testnet · no live deployments'}
              </small>
            </div>
          </div>
          {!demoMode && liveNotice}
          {page === 'Trade' && (
            <>
              <section className="hero-banner">
                <div className="hero-content">
                  <span className="hero-badge">
                    <Sparkles size={13} /> A NEW WAY TO MOVE
                  </span>
                  <h2>
                    Less friction.
                    <br />
                    More possibility.
                  </h2>
                  <p>
                    Your all-in-one DeFi home on Arc.
                    <br />
                    Built for the way you trade.
                  </p>
                  <button onClick={() => setPage('Discover')}>
                    Explore the ecosystem <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="orbit-art" aria-hidden="true">
                  <div className="art-ring ring-one" />
                  <div className="art-ring ring-two" />
                  <div className="art-ring ring-three" />
                  <div className="art-core">
                    <img src="/orbit-mark.svg" alt="" />
                  </div>
                  <div className="art-token art-usdc">$</div>
                  <div className="art-token art-eth">♦</div>
                  <div className="art-token art-star">✳</div>
                  <div className="art-label">
                    <span /> Powered by Arc
                  </div>
                </div>
                <div className="hero-caption">ONE NETWORK. ENDLESS POSSIBILITIES.</div>
              </section>
              <div className="market-strip">
                {tokens.map((t, i) => (
                  <div className="market-item" key={t.symbol}>
                    <TokenIcon symbol={t.symbol} small />
                    <div>
                      <strong>
                        {t.symbol}
                        <span>{t.name}</span>
                      </strong>
                      <b>{usd(t.price)}</b>
                    </div>
                    <span className={`change ${i === 3 ? 'negative' : ''}`}>
                      {i === 3 ? '−0.12' : i === 0 ? '+0.01' : i === 1 ? '+2.84' : '+1.62'}%
                    </span>
                    <svg
                      viewBox="0 0 70 26"
                      className={`sparkline ${i === 3 ? 'negative' : ''}`}
                      aria-hidden="true"
                    >
                      <path
                        d={
                          i === 3
                            ? 'M0 6 L9 10 L18 8 L26 15 L35 11 L44 20 L55 16 L70 22'
                            : 'M0 23 L8 18 L16 20 L26 10 L34 14 L44 5 L54 9 L61 3 L70 5'
                        }
                      />
                    </svg>
                  </div>
                ))}
              </div>
              <div className="trade-grid">
                <section className="card swap-card">
                  <div className="section-top">
                    <h2>Swap</h2>
                    <button
                      className="icon-button"
                      aria-label="Swap settings"
                      onClick={() => setModal('settings')}
                    >
                      <Settings2 size={19} />
                    </button>
                  </div>
                  <p className="subtle swap-subtitle">A better route for every trade.</p>
                  <div className="token-field">
                    <div className="field-label">
                      <label htmlFor="swap-amount">You pay</label>
                      <span>
                        {demoMode
                          ? `Balance: ${demo.balances[from.symbol].toFixed(4)}`
                          : 'Balance: —'}{' '}
                        <button
                          onClick={() => demoMode && setAmount(String(demo.balances[from.symbol]))}
                          disabled={!demoMode}
                        >
                          MAX
                        </button>
                      </span>
                    </div>
                    <div className="amount-row">
                      <input
                        id="swap-amount"
                        inputMode="decimal"
                        autoComplete="off"
                        value={amount}
                        placeholder="0"
                        onChange={(e) => setAmount(e.target.value)}
                      />
                      <button
                        className="token-select"
                        onClick={() => {
                          setQuery('');
                          setTokenPicker('from');
                        }}
                      >
                        <TokenIcon symbol={from.symbol} small />
                        {from.symbol}
                        <ChevronDown size={15} />
                      </button>
                    </div>
                    <div className="fiat-value">{usd(Number(amount || 0) * from.price || 0)}</div>
                  </div>
                  <div className="swap-divider">
                    <button
                      aria-label="Reverse token pair"
                      onClick={() => {
                        setFrom(to);
                        setTo(from);
                        setAmount('');
                      }}
                    >
                      <ArrowDown size={18} />
                    </button>
                  </div>
                  <div className="token-field receive">
                    <div className="field-label">
                      <span>You receive</span>
                      <span>
                        {demoMode
                          ? `Balance: ${demo.balances[to.symbol].toFixed(4)}`
                          : 'Balance: —'}
                      </span>
                    </div>
                    <div className="amount-row">
                      <output>{output ? output.toFixed(6) : '0'}</output>
                      <button
                        className="token-select"
                        onClick={() => {
                          setQuery('');
                          setTokenPicker('to');
                        }}
                      >
                        <TokenIcon symbol={to.symbol} small />
                        {to.symbol}
                        <ChevronDown size={15} />
                      </button>
                    </div>
                    <div className="fiat-value">{usd(output * to.price)}</div>
                  </div>
                  <div className="route-preview">
                    <span>
                      <span className="route-dot" /> Demo route
                    </span>
                    <span>
                      0.30% fee <ChevronDown size={13} />
                    </span>
                  </div>
                  <button
                    className="primary swap-submit"
                    disabled={
                      !demoMode ||
                      !validAmount(amount) ||
                      Number(amount) > demo.balances[from.symbol]
                    }
                    onClick={() => setModal('confirm')}
                  >
                    {!demoMode
                      ? 'Live router unavailable'
                      : !validAmount(amount)
                        ? 'Enter an amount'
                        : Number(amount) > demo.balances[from.symbol]
                          ? `Insufficient ${from.symbol}`
                          : 'Review swap'}
                    <ArrowRight size={17} />
                  </button>
                  <div className="swap-footnote">
                    <ShieldCheck size={13} />{' '}
                    {demoMode ? 'Simulated swap · no wallet required' : 'No transactions enabled'}
                  </div>
                </section>
                <section className="card chart-card">
                  <div className="section-top">
                    <div className="chart-pair">
                      <div className="paired-icons">
                        <TokenIcon symbol="ETH" small />
                        <TokenIcon symbol="USDC" small />
                      </div>
                      <h2>ETH / USDC</h2>
                      <span className="tiny-tag">Demo</span>
                    </div>
                    <span className="subtle chart-source">Illustrative market</span>
                  </div>
                  <div className="chart-price">
                    $2,684<span>.32</span>
                    <span className="price-change">
                      <TrendingUp size={14} /> 2.84%
                    </span>
                  </div>
                  <div className="chart-timeframes">
                    {['1H', '24H', '1W', '1M', '1Y'].map((t) => (
                      <button
                        key={t}
                        className={timeframe === t ? 'selected' : ''}
                        onClick={() => setTimeframe(t)}
                      >
                        {t}
                      </button>
                    ))}
                    <span>ETH price · {timeframe}</span>
                  </div>
                  <div className="chart">
                    <div className="chart-axis">
                      <span>2,800</span>
                      <span>2,700</span>
                      <span>2,600</span>
                      <span>2,500</span>
                    </div>
                    <svg
                      viewBox="0 0 640 205"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label={`Illustrative Ethereum ${timeframe} price chart, not live data`}
                    >
                      <defs>
                        <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8966f8" stopOpacity=".20" />
                          <stop offset="100%" stopColor="#8966f8" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[20, 70, 120, 170].map((y) => (
                        <line
                          key={y}
                          x1="0"
                          y1={y}
                          x2="640"
                          y2={y}
                          stroke="#eef0f5"
                          strokeDasharray="4 5"
                        />
                      ))}
                      <path
                        d={`${chartLine(timeframe)} L640 205 L0 205 Z`}
                        fill="url(#chart-fill)"
                      />
                      <path
                        d={chartLine(timeframe)}
                        fill="none"
                        stroke="#8860f3"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />
                      <circle cx="640" cy="32" r="4" fill="#8860f3" />
                    </svg>
                    <div className="chart-dates">
                      {(timeframe === '1H'
                        ? ['00m', '10m', '20m', '30m', '40m', '50m']
                        : timeframe === '24H'
                          ? ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']
                          : timeframe === '1M'
                            ? ['Week 1', 'Week 2', 'Week 3', 'Week 4']
                            : timeframe === '1Y'
                              ? ['Jan', 'Mar', 'May', 'Jul', 'Sep', 'Nov']
                              : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                      ).map((d) => (
                        <span key={d}>{d}</span>
                      ))}
                    </div>
                  </div>
                  <div className="chart-stats">
                    <div>
                      <span>24h volume</span>
                      <strong>$482.6K</strong>
                    </div>
                    <div>
                      <span>Liquidity</span>
                      <strong>$2.84M</strong>
                    </div>
                    <div>
                      <span>24h high</span>
                      <strong>$2,721.84</strong>
                    </div>
                    <div>
                      <span>24h low</span>
                      <strong>$2,586.20</strong>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
          {(page === 'Trade' || page === 'Discover') && (
            <section className="pools-section">
              <div className="section-heading">
                <div>
                  <h2>
                    Popular pools <span className="tiny-tag">Demo</span>
                  </h2>
                  <p>Find a little more potential in your assets.</p>
                </div>
                {page === 'Trade' && (
                  <button className="text-button" onClick={() => setPage('Discover')}>
                    Explore all pools <ArrowRight size={15} />
                  </button>
                )}
              </div>
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pool</th>
                      <th>Total liquidity</th>
                      <th>Volume (24h)</th>
                      <th>
                        APR <CircleHelp size={12} />
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pools.map((p) => (
                      <tr key={p.name}>
                        <td>
                          <div className="pool-name">
                            <div className="paired-icons">
                              {p.symbols.map((s) => (
                                <TokenIcon key={s} symbol={s} small />
                              ))}
                            </div>
                            <div>
                              <strong>{p.name}</strong>
                              <span>
                                {p.type} <i>0.3%</i>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{p.tvl}</td>
                        <td>{p.volume}</td>
                        <td>
                          <span className="apr">{p.apr}</span>
                        </td>
                        <td>
                          <button
                            className="pool-action"
                            onClick={() => {
                              setSelectedPool(p);
                              setModal('pool');
                            }}
                          >
                            View pool <ArrowUpRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {page === 'Discover' && (
            <section>
              <div className="section-heading">
                <div>
                  <h2>
                    Ready for liftoff <span className="tiny-tag">Demo launchpad</span>
                  </h2>
                  <p>
                    Meet the next generation of Arc projects. Fictional projects, virtual
                    contributions.
                  </p>
                </div>
                <span className="badge-green">
                  <Flame size={13} /> 3 open sales
                </span>
              </div>
              <div className="launch-grid">
                {launches.map((l) => (
                  <article className="card launch-card" key={l.id}>
                    <div className="launch-art" style={{ background: l.color }}>
                      <span>{l.mark}</span>
                      <span className="launch-category">{l.tag}</span>
                    </div>
                    <div className="launch-body">
                      <div className="section-top">
                        <h3>{l.name}</h3>
                        <span className="tiny-tag">{l.ticker}</span>
                      </div>
                      <p>{l.description}</p>
                      <div className="launch-progress">
                        <i style={{ width: `${l.progress}%` }} />
                      </div>
                      <div className="launch-raised">
                        <strong>
                          {l.raised}
                          <small> / {l.goal}</small>
                        </strong>
                        <span>{l.progress}%</span>
                      </div>
                      <button
                        className="secondary full"
                        disabled={demo.joined.includes(l.id) || !demoMode}
                        onClick={() => {
                          setSelectedLaunch(l);
                          setActionAmount('100');
                          setModal('launch');
                        }}
                      >
                        {demo.joined.includes(l.id) ? 'Contribution recorded' : 'Explore sale'}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {page === 'Lend' && (
            <>
              <div className="summary-grid">
                <Summary
                  label="Your supplied balance"
                  value={demoMode ? usd(demo.supplied) : '—'}
                  note="USDC · demo position"
                  icon={Wallet}
                />
                <Summary
                  label="Illustrative supply APY"
                  value="4.82%"
                  note="Variable · not a guarantee"
                  icon={TrendingUp}
                />
                <Summary
                  label="Borrowing"
                  value="Not enabled"
                  note="Requires verified lending deployment"
                  icon={LockKeyhole}
                />
              </div>
              <section className="card lending-card">
                <div className="section-top">
                  <h2>Supply markets</h2>
                  <span className="tiny-tag">Demo · Aave-style</span>
                </div>
                <p className="subtle">Keep it simple. Start with a stablecoin.</p>
                <div className="lending-market">
                  <div className="pool-name">
                    <TokenIcon symbol="USDC" />
                    <div>
                      <strong>USD Coin</strong>
                      <span>USDC</span>
                    </div>
                  </div>
                  <div>
                    <span className="subtle">Supply APY</span>
                    <strong className="green">4.82%</strong>
                  </div>
                  <div>
                    <span className="subtle">Your supply</span>
                    <strong>{demoMode ? usd(demo.supplied) : '—'}</strong>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={!demoMode || !demo.supplied}
                      onClick={() => openLend('Withdraw')}
                    >
                      Withdraw
                    </button>
                    <button
                      className="primary"
                      disabled={!demoMode}
                      onClick={() => openLend('Supply')}
                    >
                      <Plus size={16} /> Supply
                    </button>
                  </div>
                </div>
                <div className="notice">
                  <ShieldCheck size={18} />
                  <span>
                    Demo lending does not accrue interest. Borrowing, collateral, and liquidation
                    require a verified market and are intentionally disabled.
                  </span>
                </div>
              </section>
              <div className="education-card">
                <div className="education-icon">
                  <LockKeyhole size={25} />
                </div>
                <div>
                  <h3>Your keys. Your choices.</h3>
                  <p>
                    Supplied funds in live lending are exposed to smart contract, liquidity, and
                    liquidation risk. APY is variable; always review the protocol before signing.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === 'Portfolio' && (
            <>
              <div className="summary-grid">
                <Summary
                  label="Demo portfolio value"
                  value={demoMode ? usd(totalValue) : '—'}
                  note="Illustrative prices · virtual assets"
                  icon={Wallet}
                />
                <Summary
                  label="Supplied assets"
                  value={demoMode ? usd(demo.supplied) : '—'}
                  note="USDC lending position"
                  icon={LayoutDashboard}
                />
                <Summary
                  label="Total activity"
                  value={String(demo.activities.length)}
                  note="Simulated transactions"
                  icon={ArrowLeftRight}
                />
              </div>
              <section className="card">
                <div className="padded section-top">
                  <h2>Your assets</h2>
                  <span className="tiny-tag">Demo balances</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Price</th>
                        <th>Balance</th>
                        <th>Value</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.map((t) => (
                        <tr key={t.symbol}>
                          <td>
                            <div className="pool-name">
                              <TokenIcon symbol={t.symbol} small />
                              <div>
                                <strong>{t.name}</strong>
                                <span>{t.symbol}</span>
                              </div>
                            </div>
                          </td>
                          <td>{usd(t.price)}</td>
                          <td>{demoMode ? demo.balances[t.symbol].toFixed(5) : '—'}</td>
                          <td>{demoMode ? usd(demo.balances[t.symbol] * t.price) : '—'}</td>
                          <td>
                            <button
                              className="pool-action"
                              onClick={() => {
                                setFrom(t);
                                setTo(tokens.find((other) => other.symbol !== t.symbol)!);
                                setPage('Trade');
                              }}
                            >
                              Trade <ArrowUpRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card activity-card">
                <div className="section-top">
                  <h2>Recent activity</h2>
                  <Clock3 size={18} />
                </div>
                {!demo.activities.length ? (
                  <div className="empty-state">
                    <ArrowLeftRight size={28} />
                    <h3>A fresh start.</h3>
                    <p>Your simulated swaps, supplies, and contributions will appear here.</p>
                    <button className="secondary" onClick={() => setPage('Trade')}>
                      Make your first move
                    </button>
                  </div>
                ) : (
                  demo.activities.map((a) => (
                    <div className="activity-row" key={a.id}>
                      <div className="activity-icon">
                        <ArrowDownLeft size={18} />
                      </div>
                      <div>
                        <strong>{a.kind}</strong>
                        <span>{a.detail}</span>
                      </div>
                      <div>
                        <strong>+{a.xp} XP</strong>
                        <span>{new Date(a.time).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
          {page === 'Rewards' && (
            <>
              <section className="rewards-hero">
                <div>
                  <span className="hero-badge">
                    <Zap size={14} /> THE ORBIT JOURNEY
                  </span>
                  <h2>Every move counts.</h2>
                  <p>
                    Build your trading habits. Grow your explorer level.
                    <br />
                    XP is local demo progress, not a token or financial reward.
                  </p>
                  <div className="reward-level">
                    <span>Level {level}</span>
                    <strong>{demo.xp} XP</strong>
                  </div>
                  <div className="reward-track">
                    <i style={{ width: `${(demo.xp % 500) / 5}%` }} />
                  </div>
                  <small>
                    {500 - (demo.xp % 500)} XP to level {level + 1}
                  </small>
                </div>
                <div className="reward-emblem">
                  <Zap size={80} strokeWidth={1.5} />
                </div>
              </section>
              <div className="section-heading">
                <div>
                  <h2>Small steps, bigger horizons.</h2>
                  <p>Explore the terminal and earn demo XP as you go.</p>
                </div>
              </div>
              <div className="quest-grid">
                {[
                  {
                    title: 'Make a move',
                    desc: 'Complete a simulated swap.',
                    xp: 25,
                    icon: ArrowLeftRight,
                    target: 'Trade',
                  },
                  {
                    title: 'Put it to work',
                    desc: 'Supply virtual USDC to lending.',
                    xp: 15,
                    icon: LayoutDashboard,
                    target: 'Lend',
                  },
                  {
                    title: 'Early explorer',
                    desc: 'Join a fictional launchpad sale.',
                    xp: 50,
                    icon: Compass,
                    target: 'Discover',
                  },
                ].map((q) => (
                  <div className="card quest-card" key={q.title}>
                    <div className="quest-icon">
                      <q.icon size={22} />
                    </div>
                    <span className="xp-badge">+{q.xp} XP</span>
                    <h3>{q.title}</h3>
                    <p>{q.desc}</p>
                    <button className="text-button" onClick={() => setPage(q.target)}>
                      Explore <ArrowRight size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="notice">
                <CircleHelp size={18} />
                <span>
                  Demo XP lives in this browser and can be reset or edited. A production rewards
                  system needs server-side receipt verification and anti-abuse controls.
                </span>
              </div>
              <button
                className="text-button reset-demo"
                onClick={() => {
                  if (
                    window.confirm(
                      'Reset virtual balances, activity, and XP? This cannot be undone.',
                    )
                  ) {
                    setDemo(structuredClone(initialDemo));
                    setToast('Demo workspace reset');
                  }
                }}
              >
                Reset demo workspace
              </button>
            </>
          )}
          {page === 'Trade' && (
            <div className="bottom-callout">
              <div className="callout-icon">
                <Zap size={20} />
              </div>
              <div>
                <strong>Trade a little. Level up a lot.</strong>
                <span>Earn demo XP with every swap and discover your next level.</span>
              </div>
              <button className="text-button" onClick={() => setPage('Rewards')}>
                Meet your rewards <ArrowRight size={15} />
              </button>
            </div>
          )}
          <footer>
            <span>
              <span className="footer-dot" /> All systems in demo
            </span>
            <span>
              Built on Arc. Made for you.{' '}
              <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
                Arc docs <ArrowUpRight size={12} />
              </a>
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {tokenPicker && (
        <Modal title="Select a token" close={() => setTokenPicker(null)}>
          <div className="search-field">
            <Search size={18} />
            <input
              autoFocus
              placeholder="Search name or symbol"
              aria-label="Search tokens"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="subtle">Demo assets · not verified Arc token addresses</p>
          <div className="token-options">
            {tokens
              .filter((t) => `${t.name} ${t.symbol}`.toLowerCase().includes(query.toLowerCase()))
              .map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => {
                    if (tokenPicker === 'from') {
                      setFrom(t);
                      if (t.symbol === to.symbol) setTo(from);
                    } else {
                      setTo(t);
                      if (t.symbol === from.symbol) setFrom(to);
                    }
                    setTokenPicker(null);
                    setAmount('');
                  }}
                >
                  <TokenIcon symbol={t.symbol} />
                  <div>
                    <strong>{t.symbol}</strong>
                    <span>{t.name}</span>
                  </div>
                  <span>{demo.balances[t.symbol].toFixed(4)}</span>
                </button>
              ))}
            {!tokens.some((t) =>
              `${t.name} ${t.symbol}`.toLowerCase().includes(query.toLowerCase()),
            ) && <p>No tokens found.</p>}
          </div>
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal title="Swap settings" close={() => setModal(null)}>
          <p className="subtle">Slippage tolerance</p>
          <div className="slippage-options">
            {[0.1, 0.5, 1].map((s) => (
              <button
                className={s === slippage ? 'selected' : ''}
                key={s}
                onClick={() => setSlippage(s)}
              >
                {s}%
              </button>
            ))}
          </div>
          <div className="notice">
            <CircleHelp size={18} />
            <span>
              Slippage controls the minimum received in your preview. Demo execution uses
              illustrative fixed prices; it does not submit a transaction.
            </span>
          </div>
          <button className="primary full" onClick={() => setModal(null)}>
            Save settings
          </button>
        </Modal>
      )}
      {modal === 'wallet' && (
        <Modal
          title={wallet.address ? 'Your wallet' : 'Connect to your orbit'}
          close={() => setModal(null)}
        >
          <div className="wallet-visual">
            <Wallet size={32} />
          </div>
          <p className="modal-intro">
            Connect an injected Ethereum-compatible wallet to read your Arc testnet balance. The
            demo works without one.
          </p>
          {wallet.address ? (
            <>
              <div className="wallet-address">
                <code>
                  {wallet.address.slice(0, 12)}…{wallet.address.slice(-8)}
                </code>
                <button
                  className="icon-button"
                  aria-label="Copy wallet address"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(wallet.address!)
                      .then(() => setToast('Address copied'))
                      .catch(() => setToast('Could not copy address'));
                  }}
                >
                  <Copy size={16} />
                </button>
              </div>
              <div className="detail-row">
                <span>Network</span>
                <strong>
                  {wallet.chainId === arcTestnet.id ? 'Arc Testnet' : 'Wrong network'}
                </strong>
              </div>
              <div className="detail-row">
                <span>Native USDC</span>
                <strong>
                  {wallet.balance ? `${Number(wallet.balance).toFixed(4)} USDC` : '—'}
                </strong>
              </div>
              {wallet.chainId !== arcTestnet.id && (
                <button
                  className="primary full"
                  disabled={wallet.pending}
                  onClick={wallet.switchNetwork}
                >
                  Switch to Arc testnet
                </button>
              )}
              <a
                className="secondary full explorer-link"
                href={`${arcTestnet.blockExplorers.default.url}/address/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer <ExternalLink size={15} />
              </a>
              <button className="text-button full" onClick={wallet.disconnect}>
                Disconnect locally
              </button>
            </>
          ) : (
            <button className="primary full" disabled={wallet.pending} onClick={wallet.connect}>
              <Wallet size={17} />
              {wallet.pending ? 'Waiting for wallet…' : 'Connect browser wallet'}
            </button>
          )}
          {wallet.error && (
            <p className="error" role="alert">
              {wallet.error}
            </p>
          )}
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              We never ask for your seed phrase. Connecting does not grant spending permission.
            </span>
          </div>
          <a
            className="text-button full"
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
          >
            Get testnet funds <ArrowUpRight size={15} />
          </a>
        </Modal>
      )}
      {modal === 'confirm' && (
        <Modal title="Review demo swap" close={() => setModal(null)}>
          <div className="review-amount">
            <TokenIcon symbol={from.symbol} />
            <strong>
              {amount} {from.symbol}
            </strong>
          </div>
          <ArrowDown className="review-arrow" size={21} />
          <div className="review-amount">
            <TokenIcon symbol={to.symbol} />
            <strong>
              {output.toFixed(6)} {to.symbol}
            </strong>
          </div>
          <div className="detail-row">
            <span>Minimum received</span>
            <strong>
              {(output * (1 - slippage / 100)).toFixed(6)} {to.symbol}
            </strong>
          </div>
          <div className="detail-row">
            <span>Illustrative fee</span>
            <strong>0.30%</strong>
          </div>
          <div className="detail-row">
            <span>Slippage</span>
            <strong>{slippage}%</strong>
          </div>
          <div className="notice">
            <Sparkles size={18} />
            <span>
              Virtual funds only. This updates local demo balances and earns 25 demo XP. No
              blockchain transaction is sent.
            </span>
          </div>
          <button className="primary full" onClick={swap}>
            Simulate swap <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {modal === 'pool' && (
        <Modal title={selectedPool.name} close={() => setModal(null)}>
          <div className="pool-modal-icons">
            {selectedPool.symbols.map((s) => (
              <TokenIcon symbol={s} key={s} />
            ))}
          </div>
          <div className="detail-row">
            <span>Illustrative liquidity</span>
            <strong>{selectedPool.tvl}</strong>
          </div>
          <div className="detail-row">
            <span>Illustrative APR</span>
            <strong className="green">{selectedPool.apr}</strong>
          </div>
          <div className="detail-row">
            <span>Swap fee</span>
            <strong>0.30%</strong>
          </div>
          <div className="notice">
            <CircleHelp size={18} />
            <span>
              This is an example pool, not a deployed Arc liquidity market. Liquidity deposits are
              unavailable. LPs face impermanent loss and smart contract risk.
            </span>
          </div>
          <button
            className="primary full"
            onClick={() => {
              setFrom(tokens.find((t) => t.symbol === selectedPool.symbols[0])!);
              setTo(tokens.find((t) => t.symbol === selectedPool.symbols[1])!);
              setPage('Trade');
              setModal(null);
            }}
          >
            Try this pair <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {modal === 'lend' && (
        <Modal title={`${lendAction} demo USDC`} close={() => setModal(null)}>
          <p className="subtle">
            Available: {usd(lendAction === 'Supply' ? demo.balances.USDC : demo.supplied)}
          </p>
          <label className="action-input-label" htmlFor="lend-amount">
            Amount in USDC
          </label>
          <div className="action-input">
            <input
              id="lend-amount"
              inputMode="decimal"
              value={actionAmount}
              onChange={(e) => setActionAmount(e.target.value)}
            />
            <TokenIcon symbol="USDC" small />
          </div>
          <div className="notice">
            <CircleHelp size={18} />
            <span>
              Simulated lending. No interest accrues and no blockchain transaction is sent.
            </span>
          </div>
          <button
            className="primary full"
            disabled={
              !demoMode ||
              !validAmount(actionAmount) ||
              Number(actionAmount) > (lendAction === 'Supply' ? demo.balances.USDC : demo.supplied)
            }
            onClick={lend}
          >
            Simulate {lendAction.toLowerCase()}
          </button>
        </Modal>
      )}
      {modal === 'launch' && (
        <Modal title={selectedLaunch.name} close={() => setModal(null)}>
          <p className="modal-intro">
            {selectedLaunch.description} This is a fictional sale for exploring the launchpad UX.
          </p>
          <div className="detail-row">
            <span>Example raise target</span>
            <strong>{selectedLaunch.goal}</strong>
          </div>
          <div className="detail-row">
            <span>Available demo USDC</span>
            <strong>{usd(demo.balances.USDC)}</strong>
          </div>
          <label className="action-input-label" htmlFor="launch-amount">
            Virtual contribution (USDC)
          </label>
          <div className="action-input">
            <input
              id="launch-amount"
              inputMode="decimal"
              value={actionAmount}
              onChange={(e) => setActionAmount(e.target.value)}
            />
            <TokenIcon symbol="USDC" small />
          </div>
          <div className="notice">
            <CircleHelp size={18} />
            <span>
              Demo contributions are deducted from virtual balances, but grant no tokens or claims.
              Nothing is deployed or transferred.
            </span>
          </div>
          <button
            className="primary full"
            disabled={
              !demoMode ||
              !validAmount(actionAmount) ||
              Number(actionAmount) > demo.balances.USDC ||
              demo.joined.includes(selectedLaunch.id)
            }
            onClick={joinLaunch}
          >
            Simulate contribution · +50 XP
          </button>
        </Modal>
      )}
    </div>
  );
}
function Summary({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
}) {
  return (
    <div className="card summary-card">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}
