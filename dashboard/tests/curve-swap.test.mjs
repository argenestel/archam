import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeTokens, protectedAmount, withinProtection, coinPage } from '../app/curve-swap-safety.ts';

test('curve swaps accept only supported whole-token quantities', () => {
  for (const input of ['', '0', '-1', '1.5', '1e3', '1000001', ' 100', 'NaN']) assert.equal(wholeTokens(input), undefined);
  assert.equal(wholeTokens('1'), 1n);
  assert.equal(wholeTokens('1000000'), 1_000_000n);
});
test('buy limit rounds up and sell minimum rounds down without floating point', () => {
  assert.equal(protectedAmount(1n, 'buy'), 2n);
  assert.equal(protectedAmount(1n, 'sell'), 0n);
  const quote = 123456789012345678901n;
  assert.equal(protectedAmount(quote, 'buy'), (quote * 101n + 99n) / 100n);
  assert.equal(protectedAmount(quote, 'sell'), quote * 99n / 100n);
});
test('fresh quotes must stay inside the previously displayed limit', () => {
  assert.equal(withinProtection(101n, 101n, 'buy'), true);
  assert.equal(withinProtection(102n, 101n, 'buy'), false);
  assert.equal(withinProtection(99n, 99n, 'sell'), true);
  assert.equal(withinProtection(98n, 99n, 'sell'), false);
});
test('coin selection navigates to the correct registry page', () => {
  assert.equal(coinPage(41n, 40n), 0);
  assert.equal(coinPage(41n, 20n), 1);
  assert.equal(coinPage(41n, 0n), 2);
  assert.equal(coinPage(0n, 0n), 0);
  assert.equal(coinPage(41n, 99n), 0);
});
