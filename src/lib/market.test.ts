import { describe, expect, it } from 'vitest';
import { demoQuote, minimumOutput, tokens, validAmount } from './market';
describe('decimal input validation', () => {
  it.each(['', '0', '-1', 'NaN', 'Infinity', '1e4', '0xFF', '1,000', '1..2', ' 1 '])(
    'rejects %s',
    (value) => expect(validAmount(value)).toBe(false),
  );
  it.each(['1', '.1', '0.01', '100.00', '1.'])('accepts %s', (value) =>
    expect(validAmount(value)).toBe(true),
  );
});
describe('quotes and minimum output', () => {
  it('uses illustrative fee exactly once', () =>
    expect(demoQuote('100', tokens[0], tokens[1])).toBeCloseTo(99.7 / 2684.32));
  it('returns zero for invalid input', () => expect(demoQuote('-1', tokens[0], tokens[1])).toBe(0));
  it('uses bigint arithmetic and rounds down', () => expect(minimumOutput(1001n, 50)).toBe(995n));
  it('supports no slippage', () => expect(minimumOutput(1001n, 0)).toBe(1001n));
  it.each([-1, 5001, 0.5, NaN])('rejects invalid basis points %s', (bps) =>
    expect(() => minimumOutput(10n, bps)).toThrow(),
  );
});
