import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { AmountBox, Empty, Notice } from '../components/ui';
import { activeChain } from '../lib/arc';
import { signingEnabled } from '../lib/appkit';
import {
  estimateBridge,
  readBridges,
  resolveBridge,
  retryBridge,
  runBridge,
  sourceChains,
  type BridgeEstimate,
  type BridgeRecord,
  type BridgeSpeed,
  type BridgeToken,
} from '../lib/bridge';
import { timeAgo, tryParse } from '../lib/format';
import { invalidate, useQuery } from '../lib/query';
import { openConnect, useWallet } from '../lib/wallet';

/** Add funds to Arc from another chain through Circle's CCTP (App Kit Bridge). */
export default function Bridge() {
  const { address, provider, onArc, switchNetwork } = useWallet();
  const chains = useQuery('bridge:chains', sourceChains, 3_600_000);
  const [from, setFrom] = useState('');
  const [token, setToken] = useState<BridgeToken>('USDC');
  const [amount, setAmount] = useState('');
  const [speed, setSpeed] = useState<BridgeSpeed>('FAST');
  const [estimate, setEstimate] = useState<BridgeEstimate>();
  const [step, setStep] = useState<'idle' | 'estimating' | 'bridging'>('idle');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<BridgeRecord[]>(readBridges);
  useEffect(() => {
    const sync = () => setHistory(readBridges());
    window.addEventListener('orbit:bridges', sync);
    return () => window.removeEventListener('orbit:bridges', sync);
  }, []);
  useEffect(() => {
    if (!from && chains.data?.length) setFrom(chains.data.find((c) => /^(Base|Base_Sepolia)$/.test(c.id))?.id ?? chains.data[0].id);
  }, [chains.data, from]);
  useEffect(() => setEstimate(undefined), [from, token, amount, speed]);
  const value = tryParse(amount, 6);
  const source = chains.data?.find((c) => c.id === from);
  const mine = history.filter((h) => h.account.toLowerCase() === address?.toLowerCase());
  const open = mine.find((h) => h.state === 'submitting' || h.state === 'unknown' || h.state === 'pending');
  const input = { from, account: address!, token, amount: value ? amount : '', speed };

  const review = async () => {
    setError('');
    setStep('estimating');
    try {
      setEstimate(await estimateBridge(provider!, input));
    } catch (e) {
      setError(((e as Error).message || 'Could not estimate this transfer.').slice(0, 200));
    } finally {
      setStep('idle');
    }
  };
  const bridge = async () => {
    setError('');
    setStep('bridging');
    try {
      const r = await runBridge(provider!, input);
      if (r.state === 'success') {
        setAmount('');
        invalidate('balances');
      } else if (r.error) setError(r.error);
    } finally {
      setStep('idle');
    }
  };

  return (
    <div className="center-col">
      <div>
        <h1 style={{ font: '600 32px/1.1 var(--cond)' }}>Add funds</h1>
      </div>
      <section className="card trade-panel" aria-label="Bridge to Arc">
        <div className="field">
          <label htmlFor="bridge-from">From</label>
          <select id="bridge-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!chains.data}>
            {(chains.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="tabs" role="group" aria-label="Token" style={{ width: 'fit-content' }}>
          {(['USDC', 'EURC'] as const).map((t) => (
            <button key={t} aria-pressed={token === t} onClick={() => setToken(t)}>
              {t}
            </button>
          ))}
        </div>
        <AmountBox label="Amount" value={amount} onChange={setAmount} decimals={6} token={<span className="token-tag">{token}</span>} />
        <div className="kv">
          <div>
            <dt>Speed</dt>
            <dd>
              <span className="tabs" style={{ padding: 2 }}>
                <button style={{ height: 24, padding: '0 9px', fontSize: 12.5 }} aria-pressed={speed === 'FAST'} onClick={() => setSpeed('FAST')}>
                  Fast
                </button>
                <button style={{ height: 24, padding: '0 9px', fontSize: 12.5 }} aria-pressed={speed === 'SLOW'} onClick={() => setSpeed('SLOW')}>
                  Standard
                </button>
              </span>
            </dd>
          </div>
          <p className="faint" style={{ margin: 0 }}>
            {speed === 'FAST' ? 'Fast: usually minutes, small Circle fee.' : 'Standard: no Circle transfer fee, can take 15+ minutes.'}
          </p>
          <div>
            <dt>Arrives at</dt>
            <dd>{address ? `${address.slice(0, 6)}…${address.slice(-4)} on ${activeChain.name}` : '—'}</dd>
          </div>
        </div>
        {estimate && (
          <dl className="kv" aria-label="Estimated fees">
            {estimate.fees.length ? (
              estimate.fees.map((f) => (
                <div key={f.type}>
                  <dt>{f.type === 'provider' ? 'Circle transfer fee' : f.type === 'forwarder' ? 'Mint on Arc (forwarding)' : f.type === 'gas' ? 'Network fee (source chain)' : f.type}</dt>
                  <dd>
                    {Number(f.amount).toFixed(4)} {f.token}
                  </dd>
                </div>
              ))
            ) : (
              <div>
                <dt>Fees</dt>
                <dd>None besides source-chain gas</dd>
              </div>
            )}
          </dl>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {open && (
          <Notice tone="warn">
            A transfer from {open.from} is {open.state === 'pending' ? 'still in progress' : 'unconfirmed'}. Check it below
            before starting another.
          </Notice>
        )}
        {!address ? (
          <button className="btn btn-primary btn-block" onClick={openConnect}>
            Connect wallet
          </button>
        ) : !signingEnabled ? (
          <button className="btn btn-primary btn-block" disabled>
            Transfers are switched off in this build
          </button>
        ) : !value ? (
          <button className="btn btn-primary btn-block" disabled>
            Enter an amount
          </button>
        ) : !estimate ? (
          <button className="btn btn-primary btn-block" disabled={step !== 'idle' || !!open} onClick={review}>
            {step === 'estimating' ? <Loader2 size={17} className="spin" /> : null} Review transfer
          </button>
        ) : (
          <button className="btn btn-primary btn-block" disabled={step !== 'idle' || !!open} onClick={bridge}>
            {step === 'bridging' ? (
              <>
                <Loader2 size={17} className="spin" /> Confirm in your wallet, then wait for Circle
              </>
            ) : (
              `Bridge ${amount} ${token} from ${source?.name ?? from}`
            )}
          </button>
        )}
        {address && !onArc && step === 'idle' && (
          <button className="btn btn-ghost" onClick={switchNetwork}>
            Switch back to {activeChain.name}
          </button>
        )}
      </section>

      <section className="card" aria-label="Your transfers">
        <div className="card-head">
          <h2>Your transfers</h2>
        </div>
        {mine.length ? (
          <ul className="list">
            {mine.map((r) => (
              <li key={r.id} style={{ display: 'grid', gap: 6 }}>
                <div className="row between">
                  <b>
                    {r.amount} {r.token} from {r.from}
                  </b>
                  <span className={r.state === 'success' ? 'up' : r.state === 'error' ? 'down' : 'muted'}>
                    {r.state === 'submitting' ? 'awaiting wallet' : r.state}, {timeAgo(r.time / 1000)} ago
                  </span>
                </div>
                {r.steps.length > 0 && (
                  <div className="row wrap" style={{ gap: 12, fontSize: 13 }}>
                    {r.steps.map((s) => (
                      <span key={s.name} className={s.state === 'error' ? 'down' : s.state === 'success' ? '' : 'muted'}>
                        {s.name}:{' '}
                        {s.explorerUrl ? (
                          <a className="link" href={s.explorerUrl} target="_blank" rel="noreferrer">
                            {s.state} <ExternalLink size={10} />
                          </a>
                        ) : (
                          s.state
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {(r.state === 'unknown' || (r.state === 'submitting' && Date.now() - r.time > 10 * 60_000)) && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <p className="faint">
                      The wallet may or may not have sent the burn. Check your {r.from} wallet history, then record what you found.
                    </p>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => resolveBridge(r, 'success')}>
                        It was sent
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => resolveBridge(r, 'error')}>
                        Nothing was sent
                      </button>
                    </div>
                  </div>
                )}
                {r.state === 'error' && provider && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ width: 'fit-content' }}
                    onClick={() => retryBridge(provider, r).catch((e) => setError((e as Error).message))}
                  >
                    Retry from where it stopped
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No transfers yet">Transfers you start from this browser show up here with explorer links.</Empty>
        )}
      </section>
    </div>
  );
}
