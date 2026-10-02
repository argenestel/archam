import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Policy engine unit checks. Uses a temp policy file; never touches the network or keys.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-policy-'));
process.env.ORBIT_AGENT_POLICY = path.join(dir, 'policy.json');
const write = (p) => fs.writeFileSync(process.env.ORBIT_AGENT_POLICY, JSON.stringify(p));
const { authorize, loadPolicy } = await import('./policy.mjs');

write({ network: 'testnet', dryRun: false, maxPerTxUsd: 5, maxDailyUsd: 1000, minGasReserveUsdc: 0.3, allowedActions: ['swap', 'earn_deposit', 'earn_withdraw'], allowedTokens: ['USDC', 'EURC'] });
const p = loadPolicy();
assert.throws(() => authorize(p, { action: 'borrow', usd: 1 }, 1), /not allowed/);
assert.throws(() => authorize(p, { action: 'swap', token: 'cirBTC', usd: 1 }, 1), /token cirBTC/);
assert.throws(() => authorize(p, { action: 'swap', token: 'USDC', usd: 6 }, 1), /per-transaction cap/);
assert.throws(() => authorize(p, { action: 'swap', token: 'USDC', usd: 1, slippageBps: 500 }, 1), /slippage/);
assert.throws(() => authorize(p, { action: 'earn_deposit', token: 'USDC', usd: 1 }, 0.1), /reserve/);
assert.deepEqual(authorize(p, { action: 'earn_withdraw', token: 'USDC', usd: 1 }, 0.1), { dryRun: false }, 'withdrawals must not be blocked by the reserve');
assert.throws(() => authorize(p, { action: 'earn_withdraw', token: 'USDC', usd: 1 }, 0.001), /needed to execute/);
assert.throws(() => authorize(p, { action: 'swap', token: 'USDC', usd: 0 }, 1), /positive/);

write({ network: 'mainnet', mainnetEnabled: true });
delete process.env.ORBIT_AGENT_ALLOW_MAINNET;
assert.throws(() => loadPolicy(), /Mainnet is locked/);
write({ network: 'mainnet', mainnetEnabled: false });
process.env.ORBIT_AGENT_ALLOW_MAINNET = '1';
assert.throws(() => loadPolicy(), /Mainnet is locked/);

console.log('policy checks passed');
