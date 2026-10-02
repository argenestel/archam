import { expect, it } from 'vitest';
import { formatAmount } from './format';
it('keeps zero unambiguous', () => expect(formatAmount(0n, 18)).toBe('0'));
it('truncates rather than rounding minimum amounts up', () =>
  expect(formatAmount(1234567890n, 9, 4)).toBe('1.2345'));
it('never renders a positive dust amount as zero', () =>
  expect(formatAmount(1n, 18)).toBe('0.000000000000000001'));
it('preserves useful precision below the normal display cutoff', () =>
  expect(formatAmount(371414845n, 18)).toBe('0.000000000371'));
it('does not convert large integer amounts to floating point', () =>
  expect(formatAmount(9007199254740993n, 0)).toBe('9007199254740993'));
import { price, compact } from './format';
it('renders sub-cent prices with subscript zeros', () => {
  expect(price(0.0000000196)).toBe('$0.0₇196');
  expect(price(0.0123)).toBe('$0.0123');
  expect(price(2684.34)).toBe('$2,684.34');
});
it('compacts large values', () => expect(compact(19_570_000)).toBe('19.6M'));
