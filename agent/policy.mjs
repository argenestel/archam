import fs from 'node:fs';
import path from 'node:path';

// Guardrails for an AI-driven fund manager. Every write goes through `authorize` first.
// The policy file is the only way to widen limits; the agent itself cannot edit it.
const root = path.dirname(new URL(import.meta.url).pathname);
export const policyPath = process.env.ORBIT_AGENT_POLICY || path.join(root, 'policy.json');
const logDir = path.join(root, 'logs');
const ledgerPath = path.join(logDir, 'actions.jsonl');

const defaults = {
  network: 'testnet',
  dryRun: true,
  maxPerTxUsd: 25,
  maxDailyUsd: 100,
  minGasReserveUsdc: 0.5,
  maxSlippageBps: 100,
  minApyImprovementBps: 50,
  minMoveUsd: 1,
  allowedActions: ['swap', 'earn_deposit', 'earn_withdraw', 'morpho_supply', 'morpho_withdraw'],
  allowedTokens: ['USDC', 'EURC'],
  vaultAllowlist: [],
  mainnetEnabled: false,
};

export function loadPolicy() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch {
    /* defaults only */
  }
  const policy = { ...defaults, ...file };
  if (policy.network === 'mainnet' && !(policy.mainnetEnabled && process.env.ORBIT_AGENT_ALLOW_MAINNET === '1'))
    throw new Error(
      'Mainnet is locked. It needs "mainnetEnabled": true in the policy AND ORBIT_AGENT_ALLOW_MAINNET=1 in the environment.',
    );
  return policy;
}

export function ledger() {
  try {
    return fs
      .readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function record(entry) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}

/** Spent USD notional of executed (non-dry-run) actions in the last 24h. */
export function spentToday(now = Date.now()) {
  return ledger()
    .filter((e) => e.status === 'executed' && now - Date.parse(e.time) < 86_400_000)
    .reduce((s, e) => s + (e.usd || 0), 0);
}

/**
 * Throws with a plain reason when an action breaks policy. Returns { dryRun } otherwise.
 * `usd` is the action's notional in USD; `slippageBps` where applicable.
 */
export function authorize(policy, { action, usd, token, vault, slippageBps }, gasUsdc) {
  if (!policy.allowedActions.includes(action)) throw new Error(`Policy: action "${action}" is not allowed.`);
  if (token && !policy.allowedTokens.includes(token)) throw new Error(`Policy: token ${token} is not allowed.`);
  if (!(usd > 0)) throw new Error('Policy: amount must be positive.');
  if (usd > policy.maxPerTxUsd) throw new Error(`Policy: $${usd} exceeds the $${policy.maxPerTxUsd} per-transaction cap.`);
  const spent = spentToday();
  if (spent + usd > policy.maxDailyUsd)
    throw new Error(`Policy: daily cap $${policy.maxDailyUsd} would be exceeded ($${spent.toFixed(2)} used).`);
  if (slippageBps !== undefined && slippageBps > policy.maxSlippageBps)
    throw new Error(`Policy: slippage ${slippageBps} bps exceeds ${policy.maxSlippageBps} bps.`);
  if (vault && policy.vaultAllowlist.length && !policy.vaultAllowlist.map((v) => v.toLowerCase()).includes(vault.toLowerCase()))
    throw new Error(`Policy: vault ${vault} is not on the allowlist.`);
  // Withdrawals bring USDC back, so they must never be blocked by the reserve rule (that could
  // strand funds); they only need enough gas to execute.
  const refills = action === 'earn_withdraw' || action === 'morpho_withdraw';
  const floor = refills ? 0.02 : policy.minGasReserveUsdc;
  if (gasUsdc !== undefined && gasUsdc < floor)
    throw new Error(`Policy: gas balance ${gasUsdc} USDC is below the ${floor} USDC ${refills ? 'needed to execute' : 'reserve'}.`);
  return { dryRun: policy.dryRun };
}
