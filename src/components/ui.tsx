import { useId, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Info, Loader2 } from 'lucide-react';
import { erc20Abi, type Address } from 'viem';
import { addressUrl, txUrl } from '../lib/arc';
import { useAllowance } from '../lib/data';
import { formatAmount } from '../lib/format';
import { useTx, type TxRequest } from '../lib/tx';
import { useWallet } from '../lib/wallet';
import type { Token } from '../lib/contracts';

/** Deterministic flat mark from an address: two tones and a quarter-circle, no remote images. */
const TONES = ['#1d5cf0', '#0b8a5a', '#d93f3f', '#8a5a00', '#6e56cf', '#0e7490', '#be185d', '#15181d'];
export function Avatar({ seed, size = 40, round = false }: { seed: string; size?: number; round?: boolean }) {
  const h = seed.toLowerCase().replace(/^0x/, '').padEnd(8, '0');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) || 0;
  const bg = TONES[n(0) % TONES.length];
  const corner = n(2) % 4;
  const cx = corner % 2 ? 0 : 32;
  const cy = corner < 2 ? 0 : 32;
  return (
    <svg className={`avatar${round ? ' round' : ''}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" fill={bg} />
      <circle cx={cx} cy={cy} r={14 + (n(4) % 10)} fill="#fff" fillOpacity={0.22 + (n(6) % 3) * 0.1} />
    </svg>
  );
}

export function Progress({ value, gold = false, label }: { value: number; gold?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className={`progress${gold ? ' gold' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export const Skeleton = ({ w = '100%', h = 16 }: { w?: number | string; h?: number }) => (
  <span className="skeleton" style={{ display: 'block', width: w, height: h }} />
);

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export const TxLink = ({ hash, children }: { hash: string; children?: ReactNode }) => (
  <a className="link" href={txUrl(hash)} target="_blank" rel="noreferrer">
    {children ?? 'View on explorer'} <ExternalLink size={11} style={{ verticalAlign: '-1px' }} />
  </a>
);
export const AddressLink = ({ address, children }: { address: string; children: ReactNode }) => (
  <a className="link mono" href={addressUrl(address)} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export function AmountBox({
  label,
  value,
  onChange,
  token,
  balance,
  decimals,
  readOnly,
  onMax,
  footer,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  token: ReactNode;
  balance?: bigint;
  decimals: number;
  readOnly?: boolean;
  onMax?: () => void;
  footer?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="amount-box">
      <label htmlFor={id}>{label}</label>
      <div className="amount-row">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          readOnly={readOnly}
          aria-label={label}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.');
            if (/^\d*\.?\d*$/.test(v)) onChange?.(v);
          }}
        />
        {token}
      </div>
      <div className="amount-meta">
        <span>{footer}</span>
        {balance !== undefined && (
          <span>
            Balance <span className="mono">{formatAmount(balance, decimals, 4)}</span>
            {onMax && balance > 0n && (
              <button className="btn-quiet" style={{ color: 'var(--accent)', fontWeight: 600 }} onClick={onMax}>
                Max
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Wallet-aware primary button. Walks the user through: connect → switch network →
 * exact approval (a separate, explicit click) → the action itself. Never chains them.
 */
export function ActionButton({
  label,
  request,
  disabledReason,
  approve,
  onDone,
  tone = 'primary',
  onConnect,
}: {
  label: string;
  request?: TxRequest;
  disabledReason?: string;
  approve?: { token: Token; spender: Address; amount: bigint };
  onDone?: () => void;
  tone?: 'primary' | 'sell';
  onConnect: () => void;
}) {
  const { address, onArc, switchNetwork, pending } = useWallet();
  const { send, busy, tx, unresolved, recheck } = useTx();
  const allowance = useAllowance(address, approve?.token.address, approve?.spender);
  const cls = `btn btn-block ${tone === 'sell' ? 'btn-sell' : 'btn-primary'}`;
  if (!address)
    return (
      <button className={cls} onClick={onConnect}>
        Connect wallet
      </button>
    );
  if (!onArc)
    return (
      <button className={cls} onClick={switchNetwork} disabled={pending}>
        Switch to Arc
      </button>
    );
  if (unresolved)
    return (
      <button className="btn btn-block btn-ghost" onClick={recheck}>
        Check pending transaction
      </button>
    );
  if (busy)
    return (
      <button className={cls} disabled aria-live="polite">
        <Loader2 size={17} className="spin" />
        {tx?.phase === 'signing' ? 'Confirm in wallet' : 'Confirming on Arc'}
      </button>
    );
  if (disabledReason || !request)
    return (
      <button className={cls} disabled>
        {disabledReason || label}
      </button>
    );
  const needsApproval = approve && approve.amount > 0n && (allowance.data ?? 0n) < approve.amount;
  if (approve && allowance.data === undefined)
    return (
      <button className={cls} disabled>
        Checking allowance…
      </button>
    );
  if (needsApproval)
    return (
      <button
        className={cls}
        onClick={async () => {
          await send(`Approve ${approve.token.symbol}`, {
            address: approve.token.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [approve.spender, approve.amount],
          });
          allowance.refresh();
        }}
      >
        Approve {formatAmount(approve.amount, approve.token.decimals, 4)} {approve.token.symbol}
      </button>
    );
  return (
    <button
      className={cls}
      onClick={async () => {
        if (await send(label, request)) onDone?.();
      }}
    >
      {label}
    </button>
  );
}
