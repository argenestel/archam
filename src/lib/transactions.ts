import type { Hash } from 'viem';
export type LocalTransaction = {
  hash: Hash;
  account: string;
  chainId: number;
  label: string;
  status: 'pending' | 'confirmed' | 'reverted' | 'unknown';
  time: number;
};
const key = 'orbit.testnet.transactions.v1';
export function readTransactions(): LocalTransaction[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (t): t is LocalTransaction =>
          t &&
          /^0x[0-9a-fA-F]{64}$/.test(t.hash) &&
          /^0x[0-9a-fA-F]{40}$/.test(t.account) &&
          t.chainId === 5042002 &&
          ['pending', 'confirmed', 'reverted', 'unknown'].includes(t.status) &&
          typeof t.label === 'string' &&
          Number.isFinite(t.time),
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}
export function saveTransaction(transaction: LocalTransaction) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        [transaction, ...readTransactions().filter((t) => t.hash !== transaction.hash)].slice(
          0,
          30,
        ),
      ),
    );
  } catch {
    /* Wallet signing never depends on local storage. */
  }
  window.dispatchEvent(new Event('orbit:transactions'));
}
