#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  context,
  earnDeposit,
  earnWithdraw,
  executePlan,
  marketData,
  planRebalance,
  portfolio,
  quoteSwap,
  swap,
} from './core.mjs';
import { ledger, loadPolicy } from './policy.mjs';

// MCP server for the Orbit fund manager. Connect from Claude Code (.mcp.json in the repo),
// Codex (~/.codex/config.toml) or any MCP client. Writes are dry-run unless the policy
// file sets dryRun=false AND the call passes confirm=true.
const server = new McpServer({ name: 'orbit-fund-manager', version: '0.1.0' });
const tool = (name, description, inputSchema, cb) => server.registerTool(name, { description, inputSchema }, cb);
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e.message }] };
  }
};
const amount = z.string().regex(/^\d+(\.\d{1,6})?$/, 'decimal string, e.g. "10.00"');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const write = {
  confirm: z.boolean().default(false).describe('Must be true to broadcast. Otherwise the action is only simulated and logged.'),
  reason: z.string().max(280).describe('One sentence explaining why, recorded in the audit log.'),
};

tool('get_policy', 'Current risk policy: network, caps, allowed actions, dry-run state.', {}, wrap(async () => loadPolicy()));

tool(
  'get_market_data',
  'Data feed: USD token prices, Arc Earn vaults (APY, liquidity, risk warnings) and Orbit Morpho market state.',
  {},
  wrap(async () => marketData(context())),
);

tool(
  'get_portfolio',
  'Balances (gas, USDC, EURC) and Earn vault positions for the agent wallet or any address.',
  { address: address.optional() },
  wrap(async ({ address: a }) => portfolio(context(), a)),
);

tool(
  'quote_swap',
  'Quote a same-chain swap through Circle App Kit (USDC, EURC, cirBTC on Arc). No transaction.',
  { tokenIn: z.enum(['USDC', 'EURC', 'cirBTC']), tokenOut: z.enum(['USDC', 'EURC', 'cirBTC']), amountIn: amount },
  wrap(async (a) => quoteSwap(context(), a)),
);

tool(
  'swap',
  'Swap tokens via Circle App Kit. Policy-capped; simulated unless confirm=true and policy dryRun=false.',
  {
    tokenIn: z.enum(['USDC', 'EURC', 'cirBTC']),
    tokenOut: z.enum(['USDC', 'EURC', 'cirBTC']),
    amountIn: amount,
    slippageBps: z.number().int().min(1).max(1000).default(50),
    ...write,
  },
  wrap(async (a) => swap(context(), a)),
);

tool(
  'earn_deposit',
  'Deposit USDC into an Arc Earn vault (lending-backed). Policy-capped.',
  { vault: address, amount, ...write },
  wrap(async (a) => earnDeposit(context(), a)),
);

tool(
  'earn_withdraw',
  'Withdraw USDC from an Arc Earn vault. Policy-capped.',
  { vault: address, amount, ...write },
  wrap(async (a) => earnWithdraw(context(), a)),
);

tool(
  'plan_rebalance',
  'Baseline yield strategy: proposes steps to keep a gas reserve and move idle/underperforming USDC into the best eligible vault. Read-only.',
  {},
  wrap(async () => planRebalance(context())),
);

tool(
  'execute_rebalance',
  'Recompute the baseline plan and run its steps through the policy engine.',
  { confirm: write.confirm },
  wrap(async ({ confirm }) => {
    const ctx = context();
    const plan = await planRebalance(ctx);
    return { plan: plan.steps, results: await executePlan(ctx, plan, { confirm }) };
  }),
);

tool(
  'get_activity',
  'Audit log of simulated, executed and failed agent actions (newest first).',
  { limit: z.number().int().min(1).max(200).default(30) },
  wrap(async ({ limit }) => ledger().reverse().slice(0, limit)),
);

await server.connect(new StdioServerTransport());
