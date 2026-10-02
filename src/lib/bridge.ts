import type { Address, EIP1193Provider } from 'viem';
import { isTestnet } from './arc';
import { adapterFor, getKit, kitChain } from './appkit';

// Bridge-in through Circle App Kit (CCTP). The user's wallet signs the burn on the source
// chain; Circle's Forwarding Service submits the mint on Arc, so no Arc gas is needed.
// This runner is separate from the Arc-only tx runner on purpose: it signs on another chain.

export type SourceChain = { id: string; name: string; chainId: number; explorer?: string };
export type BridgeToken = 'USDC' | 'EURC';
export type BridgeSpeed = 'FAST' | 'SLOW';
export type BridgeStep = { name: string; state: string; txHash?: string; explorerUrl?: string };
export type BridgeRecord = {
  id: string;
  time: number;
  account: Address;
  from: string;
  token: BridgeToken;
  amount: string;
  speed: BridgeSpeed;
  /** submitting = sent to the wallet, outcome not yet known. Never auto-resubmitted. */
  state: 'submitting' | 'pending' | 'success' | 'error' | 'unknown';
  steps: BridgeStep[];
  error?: string;
};

const KEY = `orbit.bridge.history.v1.${isTestnet ? 'testnet' : 'mainnet'}`;
export function readBridges(): BridgeRecord[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? (v as BridgeRecord[]).slice(0, 30) : [];
  } catch {
    return [];
  }
}
function saveBridge(r: BridgeRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify([r, ...readBridges().filter((x) => x.id !== r.id)].slice(0, 30)));
  } catch {
    /* history is a convenience; the chain is the record */
  }
  window.dispatchEvent(new Event('orbit:bridges'));
}

/** EVM source chains Circle can bridge from to this network's Arc (no Solana adapter yet). */
export async function sourceChains(): Promise<SourceChain[]> {
  const kit = await getKit();
  const all = kit.getSupportedChains('bridge') as unknown as {
    type: string;
    chain: string;
    title?: string;
    name: string;
    chainId?: number;
    isTestnet: boolean;
    explorerUrl?: string;
  }[];
  return all
    .filter((c) => c.type === 'evm' && c.isTestnet === isTestnet && c.chain !== kitChain && c.chainId)
    .map((c) => ({ id: c.chain, name: c.title ?? c.name, chainId: c.chainId!, explorer: c.explorerUrl }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function params(adapter: unknown, from: string, account: Address, token: BridgeToken, amount: string, speed: BridgeSpeed) {
  return {
    from: { adapter, chain: from },
    to: { recipientAddress: account, chain: kitChain, useForwarder: true },
    amount,
    token,
    config: { transferSpeed: speed },
  } as never;
}

export type BridgeEstimate = { fees: { type: string; token: string; amount: string }[]; raw: unknown };
export async function estimateBridge(
  provider: EIP1193Provider,
  { from, account, token, amount, speed }: { from: string; account: Address; token: BridgeToken; amount: string; speed: BridgeSpeed },
): Promise<BridgeEstimate> {
  const kit = await getKit();
  const adapter = await adapterFor(provider);
  const est = (await kit.estimateBridge(params(adapter, from, account, token, amount, speed))) as unknown as {
    fees?: { type: string; token: string; amount: string | null }[];
  };
  return {
    fees: (est.fees ?? []).filter((f) => f.amount && Number(f.amount) > 0).map((f) => ({ ...f, amount: f.amount! })),
    raw: est,
  };
}

const stepsOf = (result: unknown): BridgeStep[] =>
  ((result as { steps?: BridgeStep[] })?.steps ?? []).map((s) => ({
    name: s.name,
    state: s.state,
    txHash: s.txHash,
    explorerUrl: s.explorerUrl,
  }));

/**
 * Journals the transfer before the wallet sees it, then runs the bridge. If the SDK throws
 * without a result, the record stays `unknown`: check the source-chain wallet before retrying.
 */
export async function runBridge(
  provider: EIP1193Provider,
  input: { from: string; account: Address; token: BridgeToken; amount: string; speed: BridgeSpeed },
): Promise<BridgeRecord> {
  const record: BridgeRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: Date.now(),
    account: input.account,
    from: input.from,
    token: input.token,
    amount: input.amount,
    speed: input.speed,
    state: 'submitting',
    steps: [],
  };
  saveBridge(record);
  const kit = await getKit();
  const adapter = await adapterFor(provider);
  try {
    const result = await kit.bridge(params(adapter, input.from, input.account, input.token, input.amount, input.speed));
    const state = (result as { state?: string }).state;
    record.state = state === 'success' ? 'success' : state === 'error' ? 'error' : 'pending';
    record.steps = stepsOf(result);
    lastResults.set(record.id, result);
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    // A rejection before anything was signed is a clean cancel; anything else is uncertain.
    record.state = /user rejected|denied|4001/i.test(message) ? 'error' : 'unknown';
    record.error = message.slice(0, 240);
  }
  saveBridge(record);
  return record;
}

/** User confirmed in their source-chain wallet what happened to an uncertain transfer. */
export function resolveBridge(record: BridgeRecord, outcome: 'success' | 'error') {
  saveBridge({ ...record, state: outcome, error: outcome === 'error' ? 'Marked as not sent after checking the wallet.' : undefined });
}

const lastResults = new Map<string, unknown>();
/** Retry a failed transfer from the SDK's own result (resumes after the burn; never re-burns). */
export async function retryBridge(provider: EIP1193Provider, record: BridgeRecord): Promise<BridgeRecord> {
  const result = lastResults.get(record.id);
  if (!result) throw new Error('Retry is only available in the session that started the transfer. Check the source-chain explorer.');
  const kit = await getKit();
  const adapter = await adapterFor(provider);
  const next = await kit.retryBridge(result as never, { from: adapter } as never);
  const state = (next as { state?: string }).state;
  const updated: BridgeRecord = {
    ...record,
    state: state === 'success' ? 'success' : state === 'error' ? 'error' : 'pending',
    steps: stepsOf(next),
    error: undefined,
  };
  lastResults.set(record.id, next);
  saveBridge(updated);
  return updated;
}
