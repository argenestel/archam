#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Drives the fund manager exactly like Claude Code would: over MCP stdio.
// `--live` also broadcasts a 1 USDC→EURC swap and the rebalance on testnet.
const live = process.argv.includes('--live');
const client = new Client({ name: 'orbit-smoke', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({ command: 'node', args: ['--import', 'tsx', '--env-file-if-exists=agent/.env', 'agent/server.mjs'] }),
);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { error: !!r.isError, data: r.isError ? text : JSON.parse(text) };
};
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
};

const { tools } = await client.listTools();
check('lists tools', tools.length >= 10, tools.map((t) => t.name).join(', '));
const policy = await call('get_policy');
check('reads policy', policy.data.network === 'testnet', `cap $${policy.data.maxPerTxUsd}/tx`);
const market = await call('get_market_data');
check('market feed has vaults', market.data.earnVaults.length > 0, `${market.data.earnVaults.length} vaults`);
const big = await call('swap', { tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '50.00', reason: 'cap test' });
check('rejects over-cap swap', big.error && /per-transaction cap/.test(big.data), big.data);
const sim = await call('swap', { tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '1.00', reason: 'simulation' });
check('simulates without confirm', sim.data.status === 'simulated');
const q = await call('quote_swap', { tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '1.00' });
check('quotes swap', !q.error, q.error ? q.data : `${q.data.estimatedOutput?.amount} EURC`);
if (live) {
  const s = await call('swap', { tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '1.00', confirm: true, reason: 'smoke: diversify 1 USDC into EURC' });
  check('executes swap', !s.error && s.data.status === 'executed', s.error ? s.data : '');
  const r = await call('execute_rebalance', { confirm: true });
  check('executes rebalance', !r.error, r.error ? r.data : JSON.stringify(r.data.plan));
  const p = await call('get_portfolio');
  check('portfolio shows vault position', p.data.earnPositions?.length > 0, JSON.stringify(p.data.wallet));
}
const log = await call('get_activity', { limit: 5 });
check('audit log records actions', log.data.length > 0, `${log.data.length} entries`);
await client.close();
