// Pure helpers. bigint for anything that reaches calldata; numbers only for display.

export const WAD = 10n ** 18n;
const VIRTUAL_SHARES = 10n ** 6n; // Morpho SharesMathLib
const VIRTUAL_ASSETS = 1n;

/** Minimum output after slippage, rounded down. */
export function withSlippage(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) throw new Error('Invalid slippage');
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

/** Curve spot price in quote units per whole token (display only). */
export function curvePrice(virtualQuote: bigint, virtualToken: bigint, quoteDecimals = 6): number {
  if (virtualToken === 0n) return 0;
  return Number(virtualQuote) / 10 ** quoteDecimals / (Number(virtualToken) / 1e18);
}

export function tradePrice(quoteAmount: bigint, tokenAmount: bigint, quoteDecimals = 6): number {
  if (tokenAmount === 0n) return 0;
  return Number(quoteAmount) / 10 ** quoteDecimals / (Number(tokenAmount) / 1e18);
}

/** Fraction of sale inventory sold, 0..1. */
export function curveProgress(tokensLeft: bigint, saleSupply: bigint): number {
  if (saleSupply === 0n) return 0;
  return Number(((saleSupply - tokensLeft) * 10_000n) / saleSupply) / 10_000;
}

export function toAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}
export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const d = totalShares + VIRTUAL_SHARES;
  return (shares * (totalAssets + VIRTUAL_ASSETS) + d - 1n) / d;
}

/** Continuously compounded APY from Morpho's per-second WAD rate. */
export function rateToApy(ratePerSecond: bigint): number {
  return Math.expm1((Number(ratePerSecond) / 1e18) * 31_536_000);
}

export function utilization(borrowed: bigint, supplied: bigint): number {
  return supplied === 0n ? 0 : Number((borrowed * 1_000_000n) / supplied) / 1_000_000;
}

/** Max borrowable loan assets for collateral at a Morpho oracle price (1e36 scale) and LLTV. */
export function maxBorrow(collateral: bigint, oraclePrice: bigint, lltv: bigint): bigint {
  return (((collateral * oraclePrice) / 10n ** 36n) * lltv) / WAD;
}

/** Health factor as a number; Infinity with no debt. Below 1 the position is liquidatable. */
export function healthFactor(
  collateral: bigint,
  borrowed: bigint,
  oraclePrice: bigint,
  lltv: bigint,
): number {
  if (borrowed === 0n) return Infinity;
  return Number((maxBorrow(collateral, oraclePrice, lltv) * 10_000n) / borrowed) / 10_000;
}

/**
 * Orbit points: a deterministic function of onchain launch-curve totals, so anyone can
 * recompute them from chain state. They have no monetary value and confer no entitlement.
 */
export function points(stats: { trades: number; volume: bigint; launches: number }): number {
  const volumePoints = Number(stats.volume / 10n ** 6n); // 1 point per USDC traded
  return stats.trades * 10 + volumePoints + stats.launches * 100;
}
export function level(total: number) {
  const index = Math.floor(Math.sqrt(total / 50));
  const floor = index * index * 50;
  const next = (index + 1) * (index + 1) * 50;
  return { level: index + 1, progress: (total - floor) / (next - floor), next };
}
