import { expect, it } from 'vitest';
import { candidatePaths } from '../pages/Swap';
import { parseTokenAmount, tryParse } from './format';
import {
  curvePrice,
  curveProgress,
  healthFactor,
  level,
  maxBorrow,
  points,
  rateToApy,
  toAssetsDown,
  toAssetsUp,
  withSlippage,
} from './math';

it('applies slippage by rounding down and rejects absurd values', () => {
  expect(withSlippage(1000n, 50)).toBe(995n);
  expect(withSlippage(999n, 100)).toBe(989n);
  expect(() => withSlippage(1n, 6000)).toThrow();
});
it('prices the curve in USDC per whole token', () => {
  // 20 USDC virtual reserve over 1.073B virtual tokens
  expect(curvePrice(20_000_000n, 1_073_000_000n * 10n ** 18n)).toBeCloseTo(1.864e-8, 10);
  expect(curveProgress(793_100_000n * 10n ** 18n, 793_100_000n * 10n ** 18n)).toBe(0);
  expect(curveProgress(0n, 793_100_000n * 10n ** 18n)).toBe(1);
});
it('matches Morpho share rounding', () => {
  expect(toAssetsDown(1n, 1_000_000n, 10n ** 12n)).toBe(0n);
  expect(toAssetsUp(1n, 1_000_000n, 10n ** 12n)).toBe(1n);
  expect(toAssetsDown(10n ** 12n, 1_000_000n, 10n ** 12n)).toBe(1_000_000n);
});
it('computes borrow limits and health with 1e36 oracle scale', () => {
  const price = 2500n * 10n ** 24n; // 1 tETH (18d) = 2500 tUSDC (6d)
  const lltv = 86n * 10n ** 16n;
  expect(maxBorrow(10n ** 18n, price, lltv)).toBe(2_150_000_000n);
  expect(healthFactor(10n ** 18n, 1_075_000_000n, price, lltv)).toBe(2);
  expect(healthFactor(10n ** 18n, 0n, price, lltv)).toBe(Infinity);
});
it('converts per-second rates to APY', () => {
  expect(rateToApy(BigInt(Math.round((0.04 / 31_536_000) * 1e18)))).toBeCloseTo(Math.expm1(0.04), 6);
});
it('derives points and levels deterministically', () => {
  expect(points({ trades: 3, volume: 25_500_000n, launches: 5 })).toBe(25);
  // many tiny trades earn nothing extra
  expect(points({ trades: 1000, volume: 999_999n, launches: 0 })).toBe(0);
  expect(level(0)).toMatchObject({ level: 1, progress: 0, next: 50 });
  expect(level(200).level).toBe(3);
});
it('parses amounts strictly', () => {
  expect(parseTokenAmount('1.5', 6)).toBe(1_500_000n);
  expect(() => parseTokenAmount('1.1234567', 6)).toThrow();
  expect(() => parseTokenAmount('0', 6)).toThrow();
  expect(tryParse('abc', 6)).toBe(0n);
});
it('tries direct and hub routes without duplicating endpoints', () => {
  const [a, b, h] = ['0xa', '0xb', '0xc'] as `0x${string}`[];
  expect(candidatePaths(a, b, [h, a])).toEqual([[a, b], [a, h, b]]);
});
