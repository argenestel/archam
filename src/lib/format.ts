import { formatUnits } from 'viem';
// Truncate display amounts; never round up a minimum or turn a positive dust amount into zero.
export function formatAmount(value: bigint, decimals: number, precision = 8): string {
  const text = formatUnits(value, decimals);
  const [whole, fraction] = text.split('.');
  if (!fraction) return text;
  let digits = precision;
  if (value > 0n && whole === '0' && !/[1-9]/.test(fraction.slice(0, precision))) {
    digits = Math.min(decimals, fraction.search(/[1-9]/) + 3);
  }
  return `${whole}.${fraction.slice(0, digits)}`;
}

export function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
}

/** Compact display value: 1.2K, 3.4M. Tiny positive values keep significant digits. */
export function compact(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs < 0.0001) return value.toExponential(1);
  if (abs < 1) return value.toPrecision(Math.max(digits, 2)).replace(/0+$/, '');
  return new Intl.NumberFormat('en-US', {
    notation: abs >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: abs >= 10_000 ? 1 : digits,
  }).format(value);
}

export function usd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${compact(Math.abs(value), digits)}`;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** Price for sub-cent launch tokens using subscript-zero notation: $0.0₇196. */
export function price(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (value >= 1) return usd(value, 4);
  const zeros = Math.max(0, -Math.floor(Math.log10(value)) - 1);
  const digits = Math.round(value * 10 ** (zeros + 3)).toString().slice(0, 3).replace(/0+$/, '') || '0';
  if (zeros < 4) return `$${value.toFixed(zeros + 3).replace(/0+$/, '')}`;
  return `$0.0${[...String(zeros)].map((d) => SUB[Number(d)]).join('')}${digits}`;
}

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function timeAgo(seconds: number, now = Date.now() / 1000): string {
  const d = Math.max(0, Math.floor(now - seconds));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

/** Strict decimal → base units. Rejects zero, negatives, overprecision and overflow. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value) || (value.split('.')[1]?.length || 0) > decimals)
    throw new Error(`Enter a positive amount with at most ${decimals} decimals`);
  const [whole = '0', fraction = ''] = value.split('.');
  const amount =
    BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('Amount out of range');
  return amount;
}
/** Like parseTokenAmount, but returns 0n for empty or invalid input (UI convenience). */
export function tryParse(value: string, decimals: number): bigint {
  try {
    return parseTokenAmount(value, decimals);
  } catch {
    return 0n;
  }
}
export const deadline = (seconds = 600) => BigInt(Math.floor(Date.now() / 1000) + seconds);
