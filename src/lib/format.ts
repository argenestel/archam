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
