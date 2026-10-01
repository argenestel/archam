export type Token = { symbol: string; name: string; price: number; color: string; mark: string; decimals: number };
// Illustrative prices only. Never used for live quotes or transaction calldata.
export const tokens: Token[] = [
  { symbol: 'USDC', name: 'USD Coin', price: 1, color: '#2775ca', mark: '$', decimals: 6 },
  { symbol: 'ETH', name: 'Ethereum', price: 2684.32, color: '#7785bd', mark: '♦', decimals: 18 },
  { symbol: 'BTC', name: 'Bitcoin', price: 64210.80, color: '#f39a32', mark: '₿', decimals: 8 },
  { symbol: 'EURC', name: 'Euro Coin', price: 1.09, color: '#456bb0', mark: '€', decimals: 6 },
];
export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
export function validAmount(value: string): boolean { return /^(?:\d+\.?\d*|\.\d+)$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0; }
export function demoQuote(value: string, from: Token, to: Token): number { return validAmount(value) ? Number(value) * from.price / to.price * 0.997 : 0; }
export function minimumOutput(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) throw new Error('Invalid slippage');
  return amount * BigInt(10000 - bps) / 10000n;
}
export type Activity = { id: string; kind: string; detail: string; time: number; xp: number };
export type DemoState = { balances: Record<string, number>; supplied: number; activities: Activity[]; xp: number; joined: string[] };
export const initialDemo: DemoState = { balances: { USDC: 1250, ETH: 0.42, BTC: 0.008, EURC: 200 }, supplied: 0, activities: [], xp: 0, joined: [] };
export const STORAGE_KEY = 'orbit.demo.v1';
export function loadDemo(): DemoState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (value && Number.isFinite(value.xp) && value.xp >= 0 && Number.isFinite(value.supplied) && value.supplied >= 0 && Array.isArray(value.activities) && Array.isArray(value.joined) && tokens.every(t => Number.isFinite(value.balances?.[t.symbol]) && value.balances[t.symbol] >= 0)) return value;
  } catch { /* Storage may be unavailable. */ }
  return structuredClone(initialDemo);
}
