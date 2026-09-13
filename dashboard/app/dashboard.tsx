"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ArrowUpRight, Search, Sparkles, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";
import { Launchpad } from "./launchpad";
import { OrderBook } from "./orderbook";
import { Portfolio } from "./portfolio";
import { Trade } from "./trade";
import { CurveSwap } from "./curve-swap";
import { PrivacyHub } from "./privacy";
import { Button, Dialog, Flex } from "@radix-ui/themes";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { MarketToken } from "./market-data";
import { TokenImage, tokenImagePath } from "./token-image";
import { V2Launchpad } from "./v2-launchpad";
import { readV2Market, useV2Factory } from "./v2-market";
import { ArcMainnetSwap } from "./arc-mainnet-swap";
import { ThemeToggle } from "./theme";

/* ───── types ───── */
type Tab = "Explore" | "Trade" | "Launch" | "Portfolio" | "Swap" | "Bridge" | "Privacy";
type Market = {
  name: string;
  symbol: string;
  kind: string;
  color: string;
  mark: string;
  description: string;
  points: number[];
  initialPrice: string;
  curveReserve: string;
};

/* ───── example markets ───── */
const markets: Market[] = [
  {
    name: "Mofu", symbol: "MOFU", kind: "Community", color: "var(--detail-accent)",
    mark: tokenImagePath("mofu"), description: "A community token for Arc. The first coin on the testnet launchpad.",
    points: [10, 18, 14, 22, 30, 27, 35, 42, 38, 50], initialPrice: "0.000001", curveReserve: "14,200",
  },
  {
    name: "Moon Cat", symbol: "MCAT", kind: "Culture", color: "var(--stone)",
    mark: tokenImagePath("cat"), description: "For night owls and internet cats with big ideas.",
    points: [5, 8, 12, 9, 15, 20, 18, 25, 22, 28], initialPrice: "0.000001", curveReserve: "8,450",
  },
  {
    name: "Little Frog", symbol: "FROG", kind: "Community", color: "var(--detail-accent)",
    mark: tokenImagePath("frog"), description: "Small frog, deep pond. A fresh community on Arc.",
    points: [3, 7, 5, 10, 8, 14, 12, 18, 16, 20], initialPrice: "0.000001", curveReserve: "5,670",
  },
  {
    name: "Orbit", symbol: "ORBIT", kind: "Social", color: "var(--stone)",
    mark: tokenImagePath("orbit"), description: "Find your people, build your orbit.",
    points: [8, 6, 10, 14, 12, 18, 22, 20, 26, 30], initialPrice: "0.000001", curveReserve: "3,210",
  },
  {
    name: "Matcha Club", symbol: "MTCH", kind: "Culture", color: "var(--detail-accent)",
    mark: tokenImagePath("matcha"), description: "Slow mornings, strong communities.",
    points: [12, 15, 13, 18, 16, 20, 24, 22, 28, 32], initialPrice: "0.000001", curveReserve: "7,890",
  },
  {
    name: "Arcade", symbol: "ARCD", kind: "Gaming", color: "var(--stone)",
    mark: tokenImagePath("arcade"), description: "Building should feel like playing.",
    points: [4, 9, 6, 12, 8, 16, 14, 20, 18, 24], initialPrice: "0.000001", curveReserve: "2,100",
  },
];

/* ───── sparkline ───── */
function SparkLine({ pts, color, w = 80, h = 28 }: { pts: number[]; color: string; w?: number; h?: number }) {
  if (pts.length < 2) return null;
  const mn = Math.min(...pts), mx = Math.max(...pts), r = mx - mn || 1;
  const d = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - mn) / r) * (h - 4) - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ───── watchlist ───── */
function useWatchlist() {
  const [stars, setStars] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const s = localStorage.getItem("mofu-stars");
      return s ? new Set(JSON.parse(s)) : new Set();
    } catch { return new Set(); }
  });
  const toggle = useCallback((sym: string) => {
    setStars(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      localStorage.setItem("mofu-stars", JSON.stringify([...next]));
      return next;
    });
  }, []);
  return { stars, toggle };
}

/* ── tab nav items ── */
const tabs: { id: Tab; label: string }[] = [
  { id: "Explore", label: "Explore" },
  { id: "Trade", label: "Trade" },
  { id: "Launch", label: "Launch" },
  { id: "Portfolio", label: "Portfolio" },
  { id: "Swap", label: "Swap" },
  { id: "Bridge", label: "Bridge" },
  { id: "Privacy", label: "Privacy" },
];

function RouteTabs({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="route-tabs" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "active" : ""}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SwapRouteSelect({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className="swap-route-select">
      <span>Route</span>
      <select aria-label="Swap route" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="v2">V2 pools</option>
        <option value="mainnet">Arc Mainnet</option>
        <option value="coins">Legacy curve</option>
        <option value="stablecoins">Circle stablecoins</option>
      </select>
    </label>
  );
}

function HeroTokenShowcase({ factory, onSwap, onLaunch }: { factory: string; onSwap: () => void; onLaunch: () => void }) {
  const market = useQuery({
    queryKey: ["hero-v2-market", factory],
    enabled: isAddress(factory),
    queryFn: () => readV2Market(factory, 0),
    refetchInterval: 15_000,
    retry: false,
  });
  const token = market.data?.tokens[0];
  const progress = token ? Math.min(100, Number(token.sold) * 100 / Number(token.cap)) : 0;
  const graduated = token?.graduated === true;

  return (
    <aside className="hero-token-showcase" aria-label="Featured graduating token">
      <div className="hero-token-glow" aria-hidden="true" />
      <div className="hero-token-topline">
        <span className="eyebrow">Latest launch</span>
        <span className={`hero-token-status ${graduated ? "is-graduated" : ""}`}>
          <span className="hero-token-status-dot" />
          {graduated ? "Graduated" : token ? "On curve" : "V2 launchpad"}
        </span>
      </div>

      {token ? (
        <>
          <div className="hero-token-identity">
            <TokenImage src={token.image} name={token.name} size={72} />
            <div>
              <h2>{token.name}</h2>
              <p>${token.symbol} <span>·</span> {token.quoteSymbol}</p>
            </div>
          </div>
          <p className="hero-token-description">
            {graduated
              ? "The curve filled and liquidity is now live in a permanently locked pool."
              : "A live community launch moving toward its locked liquidity pool."}
          </p>
          <div className="hero-token-progress" aria-label={`${progress.toFixed(1)} percent toward graduation`}>
            <div className="hero-token-progress-label">
              <span>{graduated ? "Pool live" : "Progress to graduation"}</span>
              <strong>{graduated ? "100%" : `${progress.toFixed(1)}%`}</strong>
            </div>
            <div className="hero-token-progress-track"><span style={{ width: `${graduated ? 100 : progress}%` }} /></div>
          </div>
          <div className="hero-token-meta">
            <span>{graduated ? "Liquidity locked" : `${(token.cap - token.sold).toLocaleString()} tokens left`}</span>
            <a href={`https://testnet.arcscan.app/token/${token.address}`} target="_blank" rel="noreferrer">View contract ↗</a>
          </div>
          <div className="hero-token-actions">
            <button className="btn-primary" onClick={onSwap}>Trade ${token.symbol} <ArrowUpRight size={14} /></button>
            {graduated && token.pool ? <a className="btn-secondary" href={`https://testnet.arcscan.app/address/${token.pool}`} target="_blank" rel="noreferrer">View pool</a> : <button className="btn-secondary" onClick={onLaunch}>Launch yours</button>}
          </div>
        </>
      ) : (
        <div className="hero-token-empty">
          <TokenImage src={tokenImagePath("mofu")} name="Mofu" size={56} />
          <strong>{market.isPending ? "Reading the live market…" : "Launch the first graduating token."}</strong>
          <p>Fill a fair curve, then let the protocol open a locked pool.</p>
          <button className="btn-secondary" onClick={onLaunch}>Launch a token</button>
        </div>
      )}
    </aside>
  );
}

/* ───── Dashboard ───── */
export default function Dashboard() {
  const [tab, setTabRaw] = useState<Tab>("Explore");
  const setTab = useCallback((t: Tab) => {
    setTabRaw(t);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (t === "Explore") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      window.history.replaceState(null, "", url);
    }
  }, []);

  /* Deep link: ?tab=Launch opens that section */
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    // Two-pass render: read the deep link after hydration to avoid an SSR mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabs.some(x => x.id === t)) setTabRaw(t as Tab);
  }, []);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [liveMode, setLiveMode] = useState(true);
  const v2Factory = useV2Factory();
  const [swapRoute, setSwapRoute] = useState("coins");
  const [swapRouteChanged, setSwapRouteChanged] = useState(false);
  const [launchRoute, setLaunchRoute] = useState("legacy");
  const [launchRouteChanged, setLaunchRouteChanged] = useState(false);
  const [exploreRoute, setExploreRoute] = useState("legacy");
  const [exploreRouteChanged, setExploreRouteChanged] = useState(false);
  const [activeToken, setActiveToken] = useState<MarketToken>();
  const effectiveSwapRoute = v2Factory && !swapRouteChanged ? "v2" : swapRoute;
  const effectiveLaunchRoute = v2Factory && !launchRouteChanged ? "v2" : launchRoute;
  const effectiveExploreRoute = v2Factory && !exploreRouteChanged ? "v2" : exploreRoute;
  const openCoin = (destination: Tab, token: MarketToken) => {
    if (busy) return;
    setActiveToken(token);
    setSwapRoute("coins");
    setSwapRouteChanged(true);
    setTab(destination);
  };
  const [selected, setSelected] = useState<Market | null>(null);
  const { stars, toggle } = useWatchlist();
  const searchRef = useRef<HTMLInputElement>(null);

  /* keyboard shortcut: / to focus search */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const navigate = useCallback((t: Tab) => { if (!busy) setTab(t); }, [busy, setTab]);

  const kinds = useMemo(() => ["All", ...Array.from(new Set(markets.map(m => m.kind)))], []);

  const filtered = useMemo(() => {
    let list = markets;
    if (filter === "Watchlist") list = list.filter(m => stars.has(m.symbol));
    else if (filter !== "All") list = list.filter(m => m.kind === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q));
    }
    return list;
  }, [filter, query, stars]);

  return (
    <div className="app">
      {/* ── header ── */}
      <header className="header">
        <div className="logo">
          <span className="brand-icon"><Sparkles size={14} /></span>
          <span className="brand-name">mofu</span>
          <span className="brand-badge">testnet</span>
        </div>

        <nav className="header-nav" aria-label="Main navigation">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`nav-item ${tab === t.id ? "active" : ""}`}
              onClick={() => navigate(t.id)}
              disabled={busy}
              aria-current={tab === t.id ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <ThemeToggle />
          <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />
          <div className="network-pill">
            <span className="network-indicator" />
            Arc Testnet
          </div>
          <a
            className="faucet-btn"
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Faucet
          </a>
        </div>
      </header>

      {/* ── main ── */}
      <main>
        {/* === Explore === */}
        {tab === "Explore" && (
          <>
            {/* hero */}
            <section className="hero hero-marketplace">
              <div className="hero-copy">
                <span className="eyebrow">Arc testnet · fair launches</span>
                <h1 className="heading-hero">From first buy to <em>pool live.</em></h1>
                <p className="hero-subtitle">Launch a token, fill its transparent bonding curve, and graduate into a permanently locked pool when the community gets there.</p>
                <div className="hero-actions">
                  <Button size="3" onClick={() => navigate("Launch")}>Launch a token <ArrowUpRight size={15} /></Button>
                  <button className="btn-secondary" onClick={() => navigate("Swap")}>Explore live pools</button>
                </div>
              </div>
              <HeroTokenShowcase factory={v2Factory} onSwap={() => navigate("Swap")} onLaunch={() => navigate("Launch")} />
            </section>

            {/* market explorer */}
            <section>
              <div className="explore-header">
                <div><span className="eyebrow">Explore the market</span><h2>Find something early.</h2><p>Real token contracts first. Concepts stay clearly marked.</p></div>
                <div className="explore-mode-toggle">
                  <button
                    className={`explore-mode-btn ${!liveMode ? "active" : ""}`}
                    disabled={busy}
                    onClick={() => setLiveMode(false)}
                  >
                    Examples
                  </button>
                  <button
                    className={`explore-mode-btn ${liveMode ? "active" : ""}`}
                    disabled={busy}
                    onClick={() => setLiveMode(true)}
                  >
                    Live onchain
                  </button>
                </div>
              </div>

              {liveMode ? (
                <>
                  <RouteTabs label="Live market version" value={effectiveExploreRoute} onChange={value => { setExploreRouteChanged(true); setExploreRoute(value); }} disabled={busy} options={[{ value: "v2", label: "V2 graduating" }, { value: "legacy", label: "Legacy" }]} />
                  {effectiveExploreRoute === "v2" ? <V2Launchpad onBusy={setBusy} hideFeatured /> : <><div className="market-mode-note"><span>Legacy market</span><strong>Curve only · never graduates</strong></div><Launchpad onBusy={setBusy} onSwap={token => openCoin("Swap", token)} /></>}
                </>
              ) : (
                <>
                  {/* filters */}
                  <div className="explore-filters-bar">
                    <div className="filter-pills">
                      {kinds.map(k => (
                        <button
                          key={k}
                          className={`filter-btn ${filter === k ? "active" : ""}`}
                          onClick={() => setFilter(k)}
                        >
                          {k}
                        </button>
                      ))}
                      <button
                        className={`filter-btn ${filter === "Watchlist" ? "active" : ""}`}
                        onClick={() => setFilter("Watchlist")}
                      >
                        <Star size={12} style={{ marginRight: 3 }} />
                        Watchlist
                      </button>
                    </div>

                    <div className="search-input-wrap">
                      <span className="search-icon-pos"><Search size={14} /></span>
                      <input
                        ref={searchRef}
                        type="text"
                        placeholder="Search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                      />
                      <kbd className="search-kbd">/</kbd>
                    </div>

                    <div className="view-switch">
                      <button
                        className={`view-btn ${viewMode === "grid" ? "active" : ""}`}
                        onClick={() => setViewMode("grid")}
                        aria-label="Grid view"
                      >
                        ▦
                      </button>
                      <button
                        className={`view-btn ${viewMode === "table" ? "active" : ""}`}
                        onClick={() => setViewMode("table")}
                        aria-label="Table view"
                      >
                        ☰
                      </button>
                    </div>
                  </div>

                  {/* cards or table */}
                  {filtered.length === 0 ? (
                    <p style={{ color: "var(--stone)", padding: "40px 0", textAlign: "center" }}>
                      {filter === "Watchlist"
                        ? "Star a coin to add it here."
                        : "No coins match your search."}
                    </p>
                  ) : viewMode === "grid" ? (
                    <div className="market-grid">
                      {filtered.map(m => (
                        <div
                          key={m.symbol}
                          className="market-card"
                          tabIndex={0}
                          role="button"
                          aria-label={`Preview ${m.name}`}
                          onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelected(m); } }}
                          onClick={() => setSelected(m)}
                        >
                          <div className="market-card-cover"><TokenImage src={m.mark} name={m.name} size={180} /></div>
                          <div className="market-card-top">
                            <div style={{ flex: 1 }}>
                              <div className="market-title-row">
                                <h3>{m.name}</h3>
                                <span>${m.symbol}</span>
                              </div>
                              <span className="market-badge-cat">{m.kind}</span>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); toggle(m.symbol); }}
                              aria-label={stars.has(m.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                              style={{ color: stars.has(m.symbol) ? "var(--spring)" : "var(--stone)", padding: 4 }}
                            >
                              <Star size={14} fill={stars.has(m.symbol) ? "currentColor" : "none"} />
                            </button>
                          </div>
                          <p className="market-desc">{m.description}</p>
                          <div className="market-card-footer">
                            <SparkLine pts={m.points} color={m.color} />
                            <span>{m.curveReserve} USDC</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pro-table-wrap">
                      <table className="pro-table">
                        <thead>
                          <tr>
                            <th></th>
                            <th>Name</th>
                            <th>Ticker</th>
                            <th>Kind</th>
                            <th>Trend</th>
                            <th className="num">Curve reserve</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(m => (
                            <tr key={m.symbol} onClick={() => setSelected(m)}>
                              <td><TokenImage src={m.mark} size={28} /></td>
                              <td style={{ fontWeight: 600 }}>{m.name}</td>
                              <td style={{ fontFamily: "var(--font-mono), monospace", color: "var(--stone)" }}>${m.symbol}</td>
                              <td><span className="market-badge-cat">{m.kind}</span></td>
                              <td><SparkLine pts={m.points} color={m.color} w={64} h={20} /></td>
                              <td className="num">{m.curveReserve} USDC</td>
                              <td>
                                <button
                                  onClick={e => { e.stopPropagation(); toggle(m.symbol); }}
                                  style={{ color: stars.has(m.symbol) ? "var(--spring)" : "var(--stone)", padding: 4 }}
                                  aria-label="Toggle watchlist"
                                >
                                  <Star size={13} fill={stars.has(m.symbol) ? "currentColor" : "none"} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* note */}
                  <p style={{ fontSize: 12, color: "var(--stone)", marginTop: 8 }}>
                    Preview markets only. Switch to live mode for onchain tokens.
                  </p>
                </>
              )}
            </section>

            {/* launch prompt */}
            {!liveMode && (
              <div className="launch-cta-banner">
                <div>
                  <h3>Deploy your own token with a fair bonding curve.</h3>
                </div>
                <button className="btn-secondary" onClick={() => navigate("Launch")}>Launch a coin</button>
              </div>
            )}

            {/* how it works */}
            {!liveMode && (
              <section className="how-it-works">
                <h2>How it works</h2>
                <p className="how-prose">
                  Launch. Trade. Swap. Bridge.
                </p>
              </section>
            )}
          </>
        )}

        {/* === Trade === */}
        {tab === "Trade" && <OrderBook key={activeToken?.address} onBusy={setBusy} initialToken={activeToken?.address} initialTokenIndex={activeToken?.index} onLaunch={() => navigate("Launch")} />}

        {/* === Launch === */}
        {tab === "Launch" && (
          <>
          <RouteTabs label="Launch version" value={effectiveLaunchRoute} onChange={value => { setLaunchRouteChanged(true); setLaunchRoute(value); }} disabled={busy} options={[{ value: "v2", label: "V2 graduating" }, { value: "legacy", label: "Legacy" }]} />
          {effectiveLaunchRoute === "v2" ? <V2Launchpad onBusy={setBusy} mode="launch" /> : <><div className="market-mode-note"><span>Legacy market</span><strong>Curve only · never graduates</strong><small>Legacy coins can be bought and sold, but they never move into a liquidity pool.</small></div><Launchpad
            onBusy={setBusy}
            onSwap={token => openCoin("Swap", token)}
            onTradePair={token => openCoin("Trade", token)}
          /></>}
          </>
        )}

        {/* === Portfolio === */}
        {tab === "Portfolio" && <Portfolio onNavigate={navigate} onCoin={openCoin} />}

        {/* === Arc Privacy === */}
        {tab === "Privacy" && <PrivacyHub onNavigate={navigate} />}

        {/* === Swap / Bridge === */}
        {tab === "Swap" && <section className="swap-workspace">
          <h1>Swap coins</h1>
          <p>Trade tokens on Arc.</p>
          <SwapRouteSelect value={effectiveSwapRoute} onChange={value => { setSwapRouteChanged(true); setSwapRoute(value); }} disabled={busy} />
          {effectiveSwapRoute === "v2" && <V2Launchpad onBusy={setBusy} mode="swap" />}
          {effectiveSwapRoute === "mainnet" && <ArcMainnetSwap onBusy={setBusy} />}
          {effectiveSwapRoute === "coins" && <CurveSwap key={activeToken?.address} initialToken={activeToken} onBusy={setBusy} onLaunch={() => navigate("Launch")} onTrade={token => openCoin("Trade", token)} />}
        </section>}
        {/* Keep Circle mounted so an incomplete bridge retains its recovery state. */}
        <div style={{ display: tab === "Bridge" || (tab === "Swap" && swapRoute === "stablecoins") ? "block" : "none" }}>
          <Trade mode={tab === "Bridge" ? "Bridge" : "Swap"} onBusy={setBusy} />
        </div>
      </main>

      {/* ── footer ── */}
      <footer className="site-footer">
        <div className="footer-inner">
          <span style={{ fontWeight: 700, fontSize: 14 }}>mofu.</span>
          <div className="footer-links">
            <a href="#" onClick={e => { e.preventDefault(); navigate("Trade"); }}>Trade</a>
            <a href="#" onClick={e => { e.preventDefault(); navigate("Launch"); }}>Launch</a>
            <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">Faucet</a>
            <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer">ArcScan</a>
          </div>
        </div>
        <div className="footer-inner">
          <span className="footer-sub">
            Testnet prototype. Test assets have no monetary value. Contracts unaudited. © 2026 Mofu
          </span>
        </div>
      </footer>

      {/* ── concept modal ── */}
      {selected && (
        <Dialog.Root open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
          <Dialog.Content className="mofu-dialog" maxWidth="460px">
            <div style={{ marginBottom: 12 }}><TokenImage src={selected.mark} size={56} /></div>
            <Dialog.Title>{selected.name}</Dialog.Title>
            <Dialog.Description>Example concept only. Not a live token or executable quote.</Dialog.Description>
            <p style={{ color: "var(--stone)", fontFamily: "var(--font-mono), monospace", fontSize: 12, marginBottom: 14 }}>
              ${selected.symbol}
            </p>
            <p style={{ color: "var(--stone)", fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
              {selected.description}
            </p>
            <div style={{ padding: "12px 0", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--stone)", fontFamily: "var(--font-mono), monospace" }}>
              <span>Initial price: {selected.initialPrice} USDC</span>
              <span>Reserve: {selected.curveReserve} USDC</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--stone)", margin: "10px 0 18px" }}>
              This is an illustrative concept. Deploy your own on the Launch tab.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => { setSelected(null); navigate("Launch"); }}>
                Launch your own
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { setSelected(null); setLiveMode(true); }}>
                See live coins
              </button>
            </div>
            <Flex justify="end" mt="4"><Dialog.Close><Button variant="soft">Close preview</Button></Dialog.Close></Flex>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </div>
  );
}
