import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Agent smart-router checks. Uses an isolated testnet policy; never broadcasts (no confirm:true).
// Run: node --import tsx --env-file-if-exists=agent/.env agent/router.test.mjs
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-router-'));
process.env.ORBIT_AGENT_POLICY = path.join(dir, 'policy.json');
fs.writeFileSync(
  process.env.ORBIT_AGENT_POLICY,
  JSON.stringify({
    network: 'testnet',
    dryRun: true,
    maxPerTxUsd: 5,
    maxDailyUsd: 1000,
    minGasReserveUsdc: 0,
    allowedActions: ['swap'],
    allowedTokens: ['USDC', 'EURC', 'tUSDC', 'tETH'],
  }),
);
const { context } = await import('./core.mjs');
const { bestSwapQuotes, swapBest } = await import('./router.mjs');

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
};

const ctx = context();

await check('swap_best refuses an over-cap amount before quoting or signing', async () => {
  await assert.rejects(
    swapBest(ctx, { tokenIn: 'tUSDC', tokenOut: 'tETH', amountIn: '6', confirm: false, reason: 'test' }),
    /per-transaction cap/,
  );
});

await check('swap_best refuses unknown token addresses instead of guessing decimals', async () => {
  await assert.rejects(
    swapBest(ctx, { tokenIn: '0x000000000000000000000000000000000000dEaD', tokenOut: 'tETH', amountIn: '1', confirm: false, reason: 'test' }),
    /not found/i,
  );
});

await check('quote_best_swap ranks testnet venues for tUSDC → tETH', async () => {
  let quotes;
  try {
    quotes = await bestSwapQuotes(ctx, { tokenIn: 'tUSDC', tokenOut: 'tETH', amountIn: '10' });
  } catch (e) {
    if (/fetch|network|timeout|HTTP/i.test(e.message)) return console.log('     (skipped: RPC unreachable)');
    throw e;
  }
  assert.ok(quotes.length >= 1, 'expected at least one venue');
  assert.ok(BigInt(quotes[0].amountOut) > 0n);
  console.log(`     best: ${quotes[0].venue}, 10 tUSDC → ${quotes[0].amountOut} wei tETH`);
});

await check('within-cap swap is simulated, not broadcast, without confirm', async () => {
  const r = await swapBest(ctx, { tokenIn: 'tUSDC', tokenOut: 'tETH', amountIn: '1', confirm: false, reason: 'test' });
  assert.equal(r.status, 'simulated');
});

fs.rmSync(dir, { recursive: true, force: true });
if (failed) process.exit(1);
console.log('router checks passed');
