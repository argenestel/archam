import type { Address, Hash } from 'viem';

export type ExternalPending = {
  account: Address;
  chainId: number;
  label: string;
  batchId: string;
  time: number;
};
const key = 'orbit.external.pending.v1';
export function readExternal(): ExternalPending | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value &&
      /^0x[0-9a-fA-F]{40}$/.test(value.account || '') &&
      Number.isSafeInteger(value.chainId) &&
      typeof value.batchId === 'string' &&
      typeof value.label === 'string'
      ? (value as ExternalPending)
      : undefined;
  } catch {
    return undefined;
  }
}
export function saveExternal(value?: ExternalPending) {
  // Fail closed: a mainnet batch must be recoverable after reload.
  if (value) localStorage.setItem(key, JSON.stringify(value));
  else localStorage.removeItem(key);
}
export function externalOutcome(result: unknown): {
  hash?: Hash;
  batchId?: string;
  status: 'confirmed' | 'pending' | 'failed';
} {
  const r = result as
    | {
        txHash?: string;
        batchId?: string;
        status?: string;
        progress?: { status?: string };
        kind?: string;
      }
    | undefined;
  const hash = /^0x[0-9a-fA-F]{64}$/.test(r?.txHash || '') ? (r!.txHash as Hash) : undefined;
  const status = r?.status || r?.progress?.status;
  if (['FAILED', 'NOT_FOUND', 'failed', 'reverted'].includes(status || ''))
    return { hash, status: 'failed' };
  if (['submitted', 'PENDING'].includes(status || '') || r?.kind === 'cross-chain')
    return { hash, batchId: r?.batchId, status: 'pending' };
  return { hash, batchId: r?.batchId, status: hash ? 'confirmed' : 'pending' };
}
