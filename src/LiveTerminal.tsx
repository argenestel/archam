import { useState } from 'react';
import {
  ArrowDown,
  Check,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { formatUnits } from 'viem';
import { arcTestnet } from './lib/arc';
import { deployedTokens, deployedRouter, deployedLaunchpad } from './lib/deployed';
import { useLiveTerminal } from './lib/useLiveTerminal';
import { minimumOutput } from './lib/market';
import { formatAmount } from './lib/format';
import Dialog from './components/Dialog';
import PoolContext from './PoolContext';

type Props = {
  address?: string;
  chainId?: number;
  page: string;
  openWallet: () => void;
  slippageBps?: number;
};
const display = formatAmount;
export default function LiveTerminal({ address, chainId, page, openWallet, slippageBps }: Props) {
  const [tolerance, setTolerance] = useState(50);
  const [tokenSide, setTokenSide] = useState<'sell' | 'buy'>('sell');
  const [dialog, setDialog] = useState<'settings' | 'faucet' | 'risk' | 'token' | 'sale' | null>(
    null,
  );
  const bps = slippageBps ?? tolerance;
  const t = useLiveTerminal(address, chainId, page, bps);
  const trade = page === 'Trade';
  const minimum = t.quote ? minimumOutput(t.quote.amountOut, bps) : 0n;
  const needsReset = t.allowance > 0n && t.allowance < t.input;
  const saleValid =
    t.connected &&
    t.ready &&
    t.saleOpen &&
    t.contribution > 0n &&
    t.contribution <= (t.balances.tUSDC || 0n) &&
    !t.blocked;
  const swapDisabled =
    t.connected &&
    (!t.ready || !t.input || !t.quote || t.input > (t.balances[t.from.symbol] || 0n) || t.blocked);
  const primaryLabel = !t.connected
    ? 'Connect wallet to transact'
    : t.phase === 'unknown'
      ? 'Check transaction status'
      : t.busy
        ? t.busy + '…'
        : !t.ready
          ? 'Connection unavailable'
          : !t.amount
            ? 'Enter an amount'
            : !t.input
              ? 'Invalid amount'
              : t.input > (t.balances[t.from.symbol] || 0n)
                ? `Insufficient ${t.from.symbol}`
                : !t.quote
                  ? 'Getting quote…'
                  : needsReset
                    ? 'Reset allowance'
                    : t.allowance < t.input
                      ? `Approve ${t.from.symbol}`
                      : 'Review swap';
  function primaryAction() {
    if (!t.connected) return openWallet();
    if (t.phase === 'unknown') return t.checkTransaction();
    if (needsReset) return t.resetSwap();
    if (t.allowance < t.input) return t.approveSwap();
    t.setReview(true);
  }
  return (
    <div className="exchange-view">
      <div className="exchange-card">
        <div className="exchange-title">
          <div className="exchange-tabs">
            <h1>{trade ? 'Swap' : 'Launchpad'}</h1>
            {trade && <span>Arc</span>}
          </div>
          <div className="exchange-tools">
            <span
              className={`connection-dot ${t.ready ? 'online' : ''}`}
              title={t.ready ? 'Arc connected' : 'Connection unavailable'}
              aria-label={t.ready ? 'Arc connected' : 'Connection unavailable'}
            />
            <button
              className="quiet-button"
              aria-label="Swap settings"
              onClick={() => setDialog('settings')}
            >
              <Settings2 size={19} />
            </button>
          </div>
        </div>
        {!t.ready && (
          <div className="recovery-strip" role="status">
            <span>
              {t.checking ? 'Connecting to Arc…' : 'Arc is unavailable. Trading is paused.'}
            </span>
            <button disabled={t.checking} onClick={t.retry}>
              <RefreshCw size={14} />
              {t.checking ? 'Checking' : 'Retry connection'}
            </button>
          </div>
        )}
        {trade ? (
          <>
            <div className="swap-input-box">
              <div className="input-caption">
                <label htmlFor="live-amount">Sell</label>
                <span>
                  {t.connected
                    ? `Balance ${display(t.balances[t.from.symbol] || 0n, t.from.decimals, 4)}`
                    : 'Not connected'}
                  {t.connected && (
                    <button
                      disabled={t.blocked}
                      onClick={() =>
                        t.setAmount(formatUnits(t.balances[t.from.symbol] || 0n, t.from.decimals))
                      }
                    >
                      Max
                    </button>
                  )}
                </span>
              </div>
              <div className="swap-amount-row">
                <input
                  id="live-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={t.amount}
                  disabled={t.blocked}
                  onChange={(e) => t.setAmount(e.target.value)}
                />
                <button
                  className="asset-pill"
                  disabled={t.blocked}
                  onClick={() => {
                    setTokenSide('sell');
                    setDialog('token');
                  }}
                >
                  <span className={`asset-dot ${t.from.symbol === 'tUSDC' ? 'usdc' : 'eth'}`}>
                    {t.from.symbol === 'tUSDC' ? '$' : '♦'}
                  </span>
                  {t.from.symbol}
                  <ChevronDown size={14} />
                </button>
              </div>
              <p className="asset-note">Test token · no monetary value</p>
            </div>
            <div className="pair-switch">
              <button aria-label="Reverse live pair" disabled={t.blocked} onClick={t.reversePair}>
                <ArrowDown size={18} />
              </button>
            </div>
            <div className="swap-input-box receive">
              <div className="input-caption">
                <span>Buy</span>
                <span>
                  {t.connected
                    ? `Balance ${display(t.balances[t.to.symbol] || 0n, t.to.decimals, 4)}`
                    : ''}
                </span>
              </div>
              <div className="swap-amount-row">
                <output
                  className={!t.quote ? 'empty-output' : undefined}
                  title={t.quote ? formatUnits(t.quote.amountOut, t.to.decimals) : undefined}
                >
                  {t.quote ? display(t.quote.amountOut, t.to.decimals) : '0'}
                </output>
                <button
                  className="asset-pill"
                  disabled={t.blocked}
                  onClick={() => {
                    setTokenSide('buy');
                    setDialog('token');
                  }}
                >
                  <span className={`asset-dot ${t.to.symbol === 'tUSDC' ? 'usdc' : 'eth'}`}>
                    {t.to.symbol === 'tUSDC' ? '$' : '♦'}
                  </span>
                  {t.to.symbol}
                  <ChevronDown size={14} />
                </button>
              </div>
              <p className="asset-note">
                {t.quote
                  ? 'Estimated output, after the pool fee'
                  : 'Enter an amount to see your quote'}
              </p>
            </div>
            {t.quote && (
              <details className="quote-details">
                <summary>
                  <span>
                    1 {t.from.symbol} ≈{' '}
                    {display(
                      (t.quote.amountOut * 10n ** BigInt(t.from.decimals)) / t.quote.amountIn,
                      t.to.decimals,
                    )}{' '}
                    {t.to.symbol}
                  </span>
                  <ChevronDown size={14} />
                </summary>
                <dl>
                  <div>
                    <dt>Minimum received</dt>
                    <dd>
                      {formatUnits(minimum, t.to.decimals)} {t.to.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>Slippage tolerance</dt>
                    <dd>{bps / 100}%</dd>
                  </div>
                  <div>
                    <dt>Pool fee</dt>
                    <dd>0.30%</dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>Uniswap V2</dd>
                  </div>
                </dl>
              </details>
            )}
            <button
              className="primary-action"
              disabled={t.phase === 'unknown' ? !!t.busy : swapDisabled || !!t.busy}
              onClick={primaryAction}
            >
              {primaryLabel}
            </button>
            {t.connected && t.input > 0n && t.allowance < t.input && t.ready && !t.blocked && (
              <p className="step-note">
                {needsReset
                  ? 'Reset the existing allowance before approving a new amount.'
                  : 'First approve the exact amount. Then review your swap.'}
              </p>
            )}
          </>
        ) : (
          <div className="sale-content">
            <div className="sale-identity">
              <span className="sale-mark">✳</span>
              <div>
                <h2>Orbit test sale</h2>
                <p>2 tORBIT per tUSDC</p>
              </div>
              <span className="sale-status">
                {!t.sale
                  ? 'Loading'
                  : t.sale.cancelled
                    ? 'Cancelled'
                    : t.saleOpen
                      ? 'Open'
                      : t.sale.successful
                        ? 'Successful'
                        : t.failed
                          ? 'Refunds open'
                          : 'Not started'}
              </span>
            </div>
            <dl className="sale-facts">
              <div>
                <dt>Raised</dt>
                <dd>{t.sale ? display(t.sale.raised, 6, 2) : '—'} / 200,000 tUSDC</dd>
              </div>
              <div>
                <dt>Minimum raise</dt>
                <dd>1,000 tUSDC</dd>
              </div>
              <div>
                <dt>Sale ends</dt>
                <dd>{new Date(Number(t.end) * 1000).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt>Your allocation</dt>
                <dd>{t.sale ? display(t.sale.allocation, 18, 4) : '—'} tORBIT</dd>
              </div>
            </dl>
            <div className="swap-input-box">
              <div className="input-caption">
                <label htmlFor="live-sale-amount">Contribute</label>
                <span>Balance {display(t.balances.tUSDC || 0n, 6, 2)}</span>
              </div>
              <div className="swap-amount-row">
                <input
                  id="live-sale-amount"
                  placeholder="0"
                  inputMode="decimal"
                  disabled={t.blocked}
                  value={t.saleAmount}
                  onChange={(e) => t.setSaleAmount(e.target.value)}
                />
                <span className="asset-pill">
                  <span className="asset-dot usdc">$</span>tUSDC
                </span>
              </div>
            </div>
            {!t.connected ? (
              <button className="primary-action" onClick={openWallet}>
                Connect wallet to transact
              </button>
            ) : (
              <button
                className="primary-action"
                disabled={!saleValid}
                onClick={() => {
                  if (t.saleAllowance > 0n && t.saleAllowance < t.contribution) t.resetSale();
                  else if (t.saleAllowance < t.contribution) t.approveSale();
                  else setDialog('sale');
                }}
              >
                {t.busy
                  ? t.busy + '…'
                  : t.saleAllowance > 0n && t.saleAllowance < t.contribution
                    ? 'Reset sale allowance'
                    : t.saleAllowance < t.contribution
                      ? 'Approve exact payment'
                      : 'Review contribution'}
              </button>
            )}
            {t.sale?.successful && t.sale.allocation > 0n && (
              <button
                className="primary-action"
                disabled={t.blocked || !t.connected}
                onClick={t.claimSale}
              >
                Claim tORBIT
              </button>
            )}
            {t.failed && !!t.sale?.contribution && (
              <button
                className="primary-action"
                disabled={t.blocked || !t.connected}
                onClick={t.refundSale}
              >
                Refund contribution
              </button>
            )}
            <p className="step-note">
              Unaudited test sale. Payment is escrowed until settlement or cancellation.
            </p>
          </div>
        )}
        {(t.error || t.quoteError) && (
          <div className="inline-error" role="alert">
            {t.error || t.quoteError}
          </div>
        )}
        {t.phase !== 'idle' && t.phase !== 'error' && (
          <div className={`transaction-state ${t.phase}`} role="status">
            <div>
              {t.phase === 'signing' || t.phase === 'pending' ? (
                <RefreshCw size={17} />
              ) : t.phase === 'success' ? (
                <Check size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              <span>
                {t.phase === 'signing'
                  ? 'Confirm in your wallet'
                  : t.phase === 'pending'
                    ? 'Transaction submitted. Waiting for confirmation.'
                    : t.phase === 'success'
                      ? 'Transaction confirmed'
                      : 'Confirmation unavailable'}
              </span>
            </div>
            {t.hash && (
              <a
                href={`${arcTestnet.blockExplorers.default.url}/tx/${t.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction <ExternalLink size={13} />
              </a>
            )}
            {!trade && t.phase === 'unknown' && (
              <button className="secondary-action" disabled={!!t.busy} onClick={t.checkTransaction}>
                Check transaction status
              </button>
            )}
          </div>
        )}
        <div className="exchange-bottom">
          <button onClick={() => setDialog('faucet')}>Get test tokens</button>
          <button onClick={() => setDialog('risk')}>
            <ShieldCheck size={13} />
            Testnet only
          </button>
        </div>
      </div>
      <details className="pool-disclosure">
        <summary>
          Pool & contract details
          <ChevronDown size={14} />
        </summary>
        <PoolContext connected={t.ready} />
        <div className="contract-row">
          <a
            href={`${arcTestnet.blockExplorers.default.url}/address/${trade ? deployedRouter : deployedLaunchpad}`}
            target="_blank"
            rel="noreferrer"
          >
            {trade ? 'Router' : 'Launchpad'} contract <ExternalLink size={13} />
          </a>
          <button onClick={t.retry} disabled={t.checking || t.blocked}>
            Refresh connection
          </button>
        </div>
      </details>
      <p className="release-caption">Testnet preview. Not audited for real funds.</p>
      {t.review && t.quote && (
        <Dialog title="Review swap" close={() => t.setReview(false)}>
          <div className="review-pair">
            <span>Sell</span>
            <strong>
              {formatUnits(t.input, t.from.decimals)} {t.from.symbol}
            </strong>
            <ArrowDown size={18} />
            <span>Receive at least</span>
            <strong>
              {formatUnits(minimum, t.to.decimals)} {t.to.symbol}
            </strong>
          </div>
          <dl className="modal-facts">
            <div>
              <dt>Recipient</dt>
              <dd>
                {address?.slice(0, 8)}…{address?.slice(-6)}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Arc testnet (5042002)</dd>
            </div>
            <div>
              <dt>Slippage / fee</dt>
              <dd>{bps / 100}% / 0.30%</dd>
            </div>
          </dl>
          <p className="dialog-note">
            Gas is paid in native testnet USDC. Your wallet will show the estimated cost before you
            sign.
          </p>
          {t.expired ? (
            <button className="primary-action" onClick={t.refreshQuote}>
              Refresh expired quote
            </button>
          ) : (
            <button
              className="primary-action"
              disabled={!t.validSwap || t.allowance < t.input}
              onClick={t.swap}
            >
              Confirm swap on Arc testnet
            </button>
          )}
        </Dialog>
      )}
      {dialog === 'settings' && (
        <Dialog title="Swap settings" close={() => setDialog(null)}>
          <p className="dialog-note">Slippage tolerance</p>
          <div className="setting-options">
            {[10, 50, 100].map((value) => (
              <button aria-pressed={bps === value} key={value} onClick={() => setTolerance(value)}>
                {value / 100}%
              </button>
            ))}
          </div>
          <p className="dialog-note">
            If the price moves beyond this tolerance, your swap will revert.
          </p>
          <button className="primary-action" onClick={() => setDialog(null)}>
            Done
          </button>
        </Dialog>
      )}
      {dialog === 'faucet' && (
        <Dialog title="Get test tokens" close={() => setDialog(null)}>
          <p className="dialog-note">
            Free tokens with no monetary value. You can claim each token once per wallet. Native Arc
            testnet USDC is still required for gas.
          </p>
          {deployedTokens.map((token) => (
            <div className="faucet-token" key={token.symbol}>
              <div>
                <strong>{token.symbol}</strong>
                <span>{display(t.balances[token.symbol] || 0n, token.decimals, 4)} available</span>
              </div>
              <button
                className="secondary-action"
                disabled={!t.ready || !t.connected || t.blocked || t.claimed[token.symbol]}
                onClick={() => {
                  setDialog(null);
                  t.faucet(token);
                }}
              >
                {t.claimed[token.symbol] ? 'Already claimed' : `Claim test ${token.symbol}`}
              </button>
            </div>
          ))}
          {!t.connected && (
            <button
              className="primary-action"
              onClick={() => {
                setDialog(null);
                openWallet();
              }}
            >
              Connect wallet to transact
            </button>
          )}
          <a
            className="text-link"
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
          >
            Get native testnet USDC for gas <ExternalLink size={13} />
          </a>
        </Dialog>
      )}
      {dialog === 'risk' && (
        <Dialog title="Testnet preview" close={() => setDialog(null)}>
          <p className="dialog-note">
            tUSDC is not Circle USDC. tETH is not real Ether. Both are freely minted test assets
            with no value.
          </p>
          <p className="dialog-note">
            The pool is seeded for testing. The launchpad is experimental and unaudited. Lending and
            rewards are not enabled for live transactions.
          </p>
          <p className="dialog-note">
            This release is not production-ready. Never send real-value assets to these contracts.
          </p>
          <button className="primary-action" onClick={() => setDialog(null)}>
            Understood
          </button>
        </Dialog>
      )}
      {dialog === 'token' && (
        <Dialog title="Choose a token" close={() => setDialog(null)}>
          {deployedTokens.map((token) => (
            <button
              className="token-option"
              key={token.symbol}
              onClick={() => {
                if (token.symbol !== (tokenSide === 'sell' ? t.from.symbol : t.to.symbol))
                  t.reversePair();
                setDialog(null);
              }}
            >
              <span className={`asset-dot ${token.symbol === 'tUSDC' ? 'usdc' : 'eth'}`}>
                {token.symbol === 'tUSDC' ? '$' : '♦'}
              </span>
              <strong>{token.symbol}</strong>
              <span>{display(t.balances[token.symbol] || 0n, token.decimals, 4)}</span>
            </button>
          ))}
        </Dialog>
      )}
      {dialog === 'sale' && (
        <Dialog title="Review contribution" close={() => setDialog(null)}>
          <p className="dialog-note">
            Contribute {formatUnits(t.contribution, 6)} valueless tUSDC to the Orbit test sale. Your
            payment stays in escrow until a successful sale ends, the sale fails, or the owner
            cancels.
          </p>
          <p className="dialog-note">
            Owner cancellation is possible before the end of the sale. This is an unaudited
            experiment, not a production token launch.
          </p>
          <button
            className="primary-action"
            disabled={!saleValid || t.saleAllowance < t.contribution}
            onClick={() => {
              setDialog(null);
              t.contribute();
            }}
          >
            Contribute test tokens
          </button>
        </Dialog>
      )}
    </div>
  );
}
