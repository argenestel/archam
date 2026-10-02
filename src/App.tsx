import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Compass,
  Landmark,
  Loader2,
  LogOut,
  Plus,
  Trophy,
  Wallet,
  X,
  XCircle,
  Bell,
} from 'lucide-react';
import { formatUnits, type Address } from 'viem';
import Dialog from './components/Dialog';
import { Avatar, TxLink } from './components/ui';
import { activeChain, addressUrl, isTestnet } from './lib/arc';
import { deployments } from './lib/contracts';
import { useFeed, useLaunches } from './lib/data';
import { compact, shortAddress, usd } from './lib/format';
import { href, useRoute, type Route } from './lib/router';
import { useFollowAlerts, useFollows } from './lib/social';
import { TxProvider, useTx } from './lib/tx';
import { openConnect, useWallet, WalletProvider } from './lib/wallet';
import Discover from './pages/Discover';

const TokenPage = lazy(() => import('./pages/TokenPage'));
const CreateLaunch = lazy(() => import('./pages/CreateLaunch'));
const Swap = lazy(() => import('./pages/Swap'));
const Lend = lazy(() => import('./pages/Lend'));
const Leaders = lazy(() => import('./pages/Leaders'));
const Portfolio = lazy(() => import('./pages/Portfolio'));

const nav: { route: Route; label: string; icon: typeof Compass }[] = [
  { route: { page: 'discover' }, label: 'Launches', icon: Compass },
  { route: { page: 'swap' }, label: 'Swap', icon: ArrowLeftRight },
  { route: { page: 'lend' }, label: 'Lend', icon: Landmark },
  { route: { page: 'leaders' }, label: 'Leaderboard', icon: Trophy },
  { route: { page: 'portfolio' }, label: 'Portfolio', icon: Wallet },
];

export default function App() {
  return (
    <WalletProvider>
      <TxProvider>
        <Shell />
      </TxProvider>
    </WalletProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [connectOpen, setConnectOpen] = useState(false);
  useEffect(() => {
    const open = () => setConnectOpen(true);
    window.addEventListener('orbit:connect', open);
    return () => window.removeEventListener('orbit:connect', open);
  }, []);
  const active = (r: Route) =>
    r.page === route.page || (r.page === 'discover' && (route.page === 'token' || route.page === 'create'));
  return (
    <div className="shell">
      <a className="sr-only" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/" aria-label="Orbit home">
            <img className="brand-mark" src="/orbit-mark.svg" alt="" />
            <span>Orbit</span>
          </a>
          <nav className="nav" aria-label="Primary">
            {nav.map((n) => (
              <a key={n.label} href={href(n.route)} aria-current={active(n.route) ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="top-actions">
            {deployments.launch && (
              <a className="btn btn-primary launch-cta" href="#/create">
                <Plus size={16} /> Launch a token
              </a>
            )}
            <span className={`net-pill${isTestnet ? ' warn' : ''}`}>{activeChain.name}</span>
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="page" id="main">
        <Suspense fallback={<div className="empty"><Loader2 className="spin" /></div>}>
          {route.page === 'discover' && <Discover />}
          {route.page === 'token' && <TokenPage address={route.address} />}
          {route.page === 'create' && <CreateLaunch />}
          {route.page === 'swap' && <Swap />}
          {route.page === 'lend' && <Lend />}
          {route.page === 'leaders' && <Leaders />}
          {route.page === 'portfolio' && <Portfolio />}
        </Suspense>
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <span>
            {isTestnet
              ? 'Testnet: assets here have no value. Orbit’s launch contract is unaudited.'
              : 'Orbit’s launch contract is unaudited. Trade only what you can lose.'}
          </span>
          <nav aria-label="Resources">
            {isTestnet && (
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                USDC faucet
              </a>
            )}
            <a href="/arc-testnet-deployment.json" target="_blank" rel="noreferrer">
              Deployment manifest
            </a>
            <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
              Arc docs
            </a>
          </nav>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="Primary mobile">
        {nav.map((n) => (
          <a key={n.label} href={href(n.route)} aria-current={active(n.route) ? 'page' : undefined}>
            <n.icon size={19} />
            {n.label}
          </a>
        ))}
      </nav>
      {connectOpen && <ConnectDialog close={() => setConnectOpen(false)} />}
      <Toasts />
      <FollowAlerts />
    </div>
  );
}

function WalletButton() {
  const { address, gas, onArc, switchNetwork, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  if (!address)
    return (
      <button className="btn btn-ghost" onClick={openConnect}>
        Connect
      </button>
    );
  if (!onArc)
    return (
      <button className="btn btn-ghost" onClick={switchNetwork} style={{ color: 'var(--gold)' }}>
        Switch to Arc
      </button>
    );
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)} aria-label={`Wallet ${address}`}>
        <Avatar seed={address} size={22} round />
        <span className="mono" style={{ fontSize: 13 }}>
          {shortAddress(address)}
        </span>
      </button>
      {open && (
        <Dialog title="Wallet" close={() => setOpen(false)}>
          <div className="dialog-body">
            <div className="row">
              <Avatar seed={address} size={44} round />
              <div className="grow">
                <a className="link mono" href={addressUrl(address)} target="_blank" rel="noreferrer">
                  {shortAddress(address)}
                </a>
                <p className="muted" style={{ fontSize: 13 }}>
                  Gas balance{' '}
                  <span className="mono">{gas === undefined ? '…' : compact(Number(formatUnits(gas, 18)), 4)} USDC</span>
                </p>
              </div>
            </div>
            <a className="btn btn-ghost" href="#/portfolio" onClick={() => setOpen(false)}>
              <Wallet size={16} /> Portfolio
            </a>
            <button
              className="btn btn-ghost"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              <LogOut size={16} /> Disconnect
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function ConnectDialog({ close }: { close: () => void }) {
  const { wallets, connect, pending, error, address } = useWallet();
  useEffect(() => {
    if (address) close();
  }, [address, close]);
  return (
    <Dialog title="Connect a wallet" close={close}>
      <div className="dialog-body">
        {wallets.length === 0 ? (
          <p className="muted">
            No browser wallet detected. Install{' '}
            <a className="link" href="https://metamask.io" target="_blank" rel="noreferrer">
              MetaMask
            </a>{' '}
            or{' '}
            <a className="link" href="https://rabby.io" target="_blank" rel="noreferrer">
              Rabby
            </a>
            , then reload.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {wallets.map((w) => (
              <button key={w.id} className="option" disabled={pending} onClick={() => connect(w)}>
                {w.icon ? <img src={w.icon} alt="" /> : <Wallet size={28} />}
                <span className="grow" style={{ fontWeight: 600 }}>
                  {w.name}
                </span>
                {pending && <Loader2 size={16} className="spin" />}
              </button>
            ))}
          </div>
        )}
        {error && <p className="down" style={{ fontSize: 13 }}>{error}</p>}
        <p className="faint" style={{ fontSize: 12 }}>
          Orbit never holds your keys. Every transaction is signed in your wallet.
        </p>
      </div>
    </Dialog>
  );
}

function Toasts() {
  const { toasts, dismiss } = useTx();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : t.tone === 'pending' ? Loader2 : Bell;
        return (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon size={18} className={`tone${t.tone === 'pending' ? ' spin' : ''}`} />
            <div>
              <b>{t.title}</b>
              {t.body && <span className="muted">{t.body} </span>}
              {t.hash && <TxLink hash={t.hash} />}
              {t.action && (
                <a className="link" href={t.action.href} style={{ marginLeft: 8 }}>
                  {t.action.label}
                </a>
              )}
            </div>
            <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function FollowAlerts() {
  const feed = useFeed(undefined, 24);
  const launches = useLaunches();
  const { follows } = useFollows();
  const { notify } = useTx();
  useFollowAlerts(feed.data, follows, (t) => {
    const token = launches.data?.find((l) => l.address.toLowerCase() === t.token.toLowerCase());
    notify({
      tone: 'info',
      title: `${shortAddress(t.trader as Address)} ${t.isBuy ? 'bought' : 'sold'} $${token?.symbol ?? 'token'}`,
      body: usd(Number(t.quoteAmount) / 1e6),
      action: { label: t.isBuy ? 'Copy trade' : 'View', href: `#/token/${t.token}` },
    });
  });
  return null;
}
