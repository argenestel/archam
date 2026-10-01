import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, ExternalLink, Wallet } from 'lucide-react';
import LiveTerminal from './LiveTerminal';
import Dialog from './components/Dialog';
import { useWallet } from './lib/useWallet';
import { arcTestnet, client } from './lib/arc';
import { readTransactions, saveTransaction, type LocalTransaction } from './lib/transactions';
import { userFacingError } from './lib/errors';
const DemoWorkspace = lazy(() => import('./DemoWorkspace'));
function Activity({ address }: { address?: string }) {
  const [transactions, setTransactions] = useState(readTransactions);
  const [checking, setChecking] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => setTransactions(readTransactions());
    window.addEventListener('orbit:transactions', refresh);
    return () => window.removeEventListener('orbit:transactions', refresh);
  }, []);
  async function check(item: LocalTransaction) {
    setChecking(item.hash);
    setError('');
    try {
      const receipt = await client.getTransactionReceipt({ hash: item.hash });
      saveTransaction({ ...item, status: receipt.status === 'success' ? 'confirmed' : 'reverted' });
    } catch (e) {
      setError(userFacingError(e, 'Confirmation is not available yet. Check the explorer.'));
    } finally {
      setChecking('');
    }
  }
  const items = transactions.filter(
    (item) => item.account.toLowerCase() === address?.toLowerCase(),
  );
  return (
    <section className="activity-panel">
      <div className="panel-heading">
        <h1>Activity</h1>
        <span>Arc testnet</span>
      </div>
      <p className="panel-description">
        Transactions submitted here, saved in this browser. This is not a full wallet history.
      </p>
      {!items.length ? (
        <div className="empty-activity">
          <Wallet size={26} />
          <h2>{address ? 'No transactions yet' : 'Connect to view activity'}</h2>
          <p>Your testnet swaps, approvals, and contributions will appear here.</p>
        </div>
      ) : (
        items.map((item) => (
          <div className="history-row" key={item.hash}>
            <div>
              <strong>{item.label}</strong>
              <span>{new Date(item.time).toLocaleString()}</span>
            </div>
            <span className={`history-status ${item.status}`}>{item.status}</span>
            <a
              aria-label={`View ${item.label} transaction`}
              href={`${arcTestnet.blockExplorers.default.url}/tx/${item.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} />
            </a>
            {(item.status === 'pending' || item.status === 'unknown') && (
              <button className="quiet-button" disabled={!!checking} onClick={() => check(item)}>
                {checking === item.hash ? 'Checking…' : 'Check'}
              </button>
            )}
          </div>
        ))
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export default function App() {
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [page, setPage] = useState('Trade');
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wallet = useWallet();
  if (mode === 'demo')
    return (
      <Suspense fallback={<div className="app-loading">Loading demo…</div>}>
        <DemoWorkspace onExit={() => setMode('live')} />
      </Suspense>
    );
  return (
    <div className="product-shell">
      <header className="product-header">
        <a
          className="product-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('Trade');
          }}
        >
          <img src="/orbit.svg" alt="" />
          orbit
        </a>
        <nav aria-label="Main navigation">
          {[
            { id: 'Trade', label: 'Swap' },
            { id: 'Discover', label: 'Launchpad' },
            { id: 'Portfolio', label: 'Activity' },
          ].map((item) => (
            <button
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="header-wallet">
          <span className="network-chip">
            <i />
            Arc testnet
          </span>
          <button className="wallet-button" onClick={() => setWalletOpen(true)}>
            <Wallet size={16} />
            {wallet.address
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : 'Connect wallet'}
          </button>
        </div>
      </header>
      <main className="product-main">
        {page === 'Portfolio' ? (
          <Activity address={wallet.address} />
        ) : (
          <LiveTerminal
            key={page}
            address={wallet.address}
            chainId={wallet.chainId}
            page={page}
            openWallet={() => setWalletOpen(true)}
          />
        )}
      </main>
      <footer className="product-footer">
        <span>Testnet preview</span>
        <div>
          <button onClick={() => setMode('demo')}>Demo</button>
          <a href="https://docs.arc.io" target="_blank" rel="noreferrer">
            Arc docs <ArrowUpRight size={12} />
          </a>
          <a href="https://github.com/Uniswap/v2-periphery" target="_blank" rel="noreferrer">
            Router source <ArrowUpRight size={12} />
          </a>
        </div>
      </footer>
      {walletOpen && (
        <Dialog
          title={wallet.address ? 'Your wallet' : 'Connect wallet'}
          close={() => setWalletOpen(false)}
        >
          {wallet.address ? (
            <>
              <div className="wallet-address">
                <code>
                  {wallet.address.slice(0, 12)}…{wallet.address.slice(-8)}
                </code>
                <button
                  className="quiet-button"
                  aria-label="Copy wallet address"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(wallet.address!)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch(() => setCopied(false));
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <dl className="modal-facts">
                <div>
                  <dt>Network</dt>
                  <dd>{wallet.chainId === arcTestnet.id ? 'Arc testnet' : 'Wrong network'}</dd>
                </div>
                <div>
                  <dt>Native USDC for gas</dt>
                  <dd>{wallet.balance ? Number(wallet.balance).toFixed(4) : 'Unavailable'}</dd>
                </div>
              </dl>
              {wallet.chainId !== arcTestnet.id && (
                <button
                  className="primary-action"
                  disabled={wallet.pending}
                  onClick={wallet.switchNetwork}
                >
                  Switch to Arc testnet
                </button>
              )}
              <a
                className="text-link"
                href={`${arcTestnet.blockExplorers.default.url}/address/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer <ExternalLink size={14} />
              </a>
              <button
                className="secondary-action full-width"
                onClick={() => {
                  wallet.disconnect();
                  setWalletOpen(false);
                }}
              >
                Disconnect locally
              </button>
            </>
          ) : (
            <>
              <p className="dialog-note">
                Use an Ethereum-compatible browser wallet. Connecting does not grant spending
                permission.
              </p>
              <button className="primary-action" disabled={wallet.pending} onClick={wallet.connect}>
                {wallet.pending ? 'Waiting for wallet…' : 'Connect browser wallet'}
              </button>
            </>
          )}
          {wallet.error && (
            <p className="inline-error" role="alert">
              {wallet.error}
            </p>
          )}
          <p className="dialog-note">
            Never share your seed phrase. Only use Arc testnet funds with this preview.
          </p>
        </Dialog>
      )}
    </div>
  );
}
