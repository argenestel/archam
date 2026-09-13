"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Search, Star, Sparkles } from "lucide-react";
import { Launchpad } from "./launchpad";
import { OrderBook } from "./orderbook";
import { Portfolio } from "./portfolio";
import { Trade } from "./trade";
import { CurveSwap } from "./curve-swap";
import { PrivacyHub } from "./privacy";
import { Button, SegmentedControl, Dialog, Flex } from "@radix-ui/themes";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { MarketToken } from "./market-data";
import { TokenImage, tokenImagePath } from "./token-image";
import { V2Launchpad } from "./v2-launchpad";

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
    name: "Mofu", symbol: "MOFU", kind: "Community", color: "#f5f5f5",
    mark: tokenImagePath("mofu"), description: "A community token for Arc. The first coin on the testnet launchpad.",
    points: [10, 18, 14, 22, 30, 27, 35, 42, 38, 50], initialPrice: "0.000001", curveReserve: "14,200",
  },
  {
    name: "Moon Cat", symbol: "MCAT", kind: "Culture", color: "#d4d4d4",
    mark: tokenImagePath("cat"), description: "For night owls and internet cats with big ideas.",
    points: [5, 8, 12, 9, 15, 20, 18, 25, 22, 28], initialPrice: "0.000001", curveReserve: "8,450",
  },
  {
    name: "Little Frog", symbol: "FROG", kind: "Community", color: "#a3a3a3",
    mark: tokenImagePath("frog"), description: "Small frog, deep pond. A fresh community on Arc.",
    points: [3, 7, 5, 10, 8, 14, 12, 18, 16, 20], initialPrice: "0.000001", curveReserve: "5,670",
  },
  {
    name: "Orbit", symbol: "ORBIT", kind: "Social", color: "#737373",
    mark: tokenImagePath("orbit"), description: "Find your people, build your orbit.",
    points: [8, 6, 10, 14, 12, 18, 22, 20, 26, 30], initialPrice: "0.000001", curveReserve: "3,210",
  },
  {
    name: "Matcha Club", symbol: "MTCH", kind: "Culture", color: "#bdbdbd",
    mark: tokenImagePath("matcha"), description: "Slow mornings, strong communities.",
    points: [12, 15, 13, 18, 16, 20, 24, 22, 28, 32], initialPrice: "0.000001", curveReserve: "7,890",
  },
  {
    name: "Arcade", symbol: "ARCD", kind: "Gaming", color: "#8f8f8f",
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
  const [swapRoute, setSwapRoute] = useState("v2");
  const [launchRoute, setLaunchRoute] = useState("v2");
  const [exploreRoute, setExploreRoute] = useState("v2");
  const [activeToken, setActiveToken] = useState<MarketToken>();
  const openCoin = (destination: Tab, token: MarketToken) => {
    if (busy) return;
    setActiveToken(token);
    setSwapRoute("coins");
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
          <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />
          <div className="network-pill">
            <span className="network-indicator" />
            Arc Testnet
          </div>
          <a
            className="faucet-btn"
            href="https://faucet.arc.dev"
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
            <section className="hero">
              <div className="hero-friends" aria-hidden="true">
                <TokenImage src={tokenImagePath("mofu")} size={48} />{" "}
                <TokenImage src={tokenImagePath("frog")} size={48} />{" "}
                <TokenImage src={tokenImagePath("orbit")} size={48} />
              </div>
              <h1 className="heading-hero">
                Launch and trade on Arc.
              </h1>
              <p className="hero-subtitle">
                Explore tokens, launch a coin, or swap with USDC.
              </p>
              <div className="hero-actions">
                <Button size="3" onClick={() => navigate("Swap")}>Swap a coin</Button>
                <button className="btn-secondary" onClick={() => navigate("Launch")}>Launch a coin</button>
              </div>
              <p className="hero-fine-print">
                Your wallet signs every transaction. Test assets have no monetary value.
              </p>
            </section>

            {/* market explorer */}
            <section>
              <div className="explore-header">
                <h2>Markets</h2>
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
                  <SegmentedControl.Root aria-label="Live market version" value={exploreRoute} onValueChange={setExploreRoute} disabled={busy}>
                    <SegmentedControl.Item value="v2">Graduating tokens</SegmentedControl.Item>
                    <SegmentedControl.Item value="legacy">Legacy coins</SegmentedControl.Item>
                  </SegmentedControl.Root>
                  {exploreRoute === "v2" ? <V2Launchpad onBusy={setBusy} /> : <Launchpad onBusy={setBusy} onSwap={token => openCoin("Swap", token)} />}
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
                    These are illustrative concepts, not live tokens.
                    Switch to live mode to discover and trade real deployments.
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
                  Connect an EVM wallet on Arc Testnet and claim test USDC from the faucet.
                  Launch a token — the bonding curve prices every buy and sell automatically.
                  Or trade on the orderbook with fully escrowed limit bids and asks.
                  Swap USDC and EURC, or bridge USDC across testnets through Circle CCTP.
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
          <SegmentedControl.Root aria-label="Launch version" value={launchRoute} onValueChange={setLaunchRoute} disabled={busy}>
            <SegmentedControl.Item value="v2">Graduating tokens</SegmentedControl.Item>
            <SegmentedControl.Item value="legacy">Legacy coins</SegmentedControl.Item>
          </SegmentedControl.Root>
          {launchRoute === "v2" ? <V2Launchpad onBusy={setBusy} mode="launch" /> : <Launchpad
            onBusy={setBusy}
            onSwap={token => openCoin("Swap", token)}
            onTradePair={token => openCoin("Trade", token)}
          />}
          </>
        )}

        {/* === Portfolio === */}
        {tab === "Portfolio" && <Portfolio onNavigate={navigate} onCoin={openCoin} />}

        {/* === Arc Privacy === */}
        {tab === "Privacy" && <PrivacyHub onNavigate={navigate} />}

        {/* === Swap / Bridge === */}
        {tab === "Swap" && <section className="swap-workspace">
          <h1>Swap coins</h1>
          <p>Swap your launched coins with USDC, or exchange stablecoins.</p>
          <SegmentedControl.Root className="swap-routes" value={swapRoute} onValueChange={setSwapRoute} disabled={busy}>
            <SegmentedControl.Item value="v2">Graduating tokens</SegmentedControl.Item>
            <SegmentedControl.Item value="coins">Launched coins</SegmentedControl.Item>
            <SegmentedControl.Item value="stablecoins">USDC / EURC</SegmentedControl.Item>
          </SegmentedControl.Root>
          {swapRoute === "v2" && <V2Launchpad onBusy={setBusy} mode="swap" />}
          {swapRoute === "coins" && <CurveSwap key={activeToken?.address} initialToken={activeToken} onBusy={setBusy} onLaunch={() => navigate("Launch")} onTrade={token => openCoin("Trade", token)} />}
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
            <a href="https://faucet.arc.dev" target="_blank" rel="noopener noreferrer">Faucet</a>
            <a href="https://testnet.arcscan.io" target="_blank" rel="noopener noreferrer">ArcScan</a>
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
