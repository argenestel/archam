import { describe, expect, it } from 'vitest';
import { parseTokenAmount } from './deployed';
describe('live token amounts', () => {
  it('handles ERC20 USDC base units exactly', () =>
    expect(parseTokenAmount('100.000001', 6)).toBe(100000001n));
  it('handles large amounts without floating point precision loss', () =>
    expect(parseTokenAmount('9007199254740993.1', 18)).toBe(9007199254740993100000000000000000n));
  it('accepts fractional notation', () => expect(parseTokenAmount('.000001', 6)).toBe(1n));
  it.each(['0', '0.0000001', '-1', '1e2', 'Infinity', '1,000', '1..1', ''])(
    'rejects invalid/overprecision %s',
    (value) => expect(() => parseTokenAmount(value, 6)).toThrow(),
  );
  it('rejects uint256 overflow', () =>
    expect(() => parseTokenAmount((2n ** 256n).toString(), 0)).toThrow());
});
