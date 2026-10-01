import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readTransactions, saveTransaction } from './transactions';
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
const base = {
  hash: `0x${'1'.repeat(64)}` as `0x${string}`,
  account: `0x${'2'.repeat(40)}`,
  chainId: 5042002,
  label: 'Approve tUSDC',
  time: 1,
};
it('keeps pending hashes and updates instead of duplicating confirmations', () => {
  saveTransaction({ ...base, status: 'pending' });
  saveTransaction({ ...base, status: 'confirmed' });
  expect(readTransactions()).toEqual([{ ...base, status: 'confirmed' }]);
});
it('drops malformed or wrong-chain browser records', () => {
  storage.set(
    'orbit.testnet.transactions.v1',
    JSON.stringify([
      { ...base, chainId: 1, status: 'pending' },
      { ...base, hash: 'malformed', status: 'confirmed' },
    ]),
  );
  expect(readTransactions()).toEqual([]);
});
it('ignores malformed storage safely', () => {
  storage.set('orbit.testnet.transactions.v1', '{');
  expect(readTransactions()).toEqual([]);
});
it('does not require working storage for wallet operations', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('Blocked');
    },
    setItem: () => {
      throw new Error('Blocked');
    },
  });
  expect(() => saveTransaction({ ...base, status: 'unknown' })).not.toThrow();
});
