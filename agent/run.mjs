#!/usr/bin/env node
import { context, executePlan, marketData, planRebalance, portfolio } from './core.mjs';

// Headless loop for scheduled runs (cron, CI, /loop): plan, then execute only with --execute.
//   node agent/run.mjs market | portfolio [0x…] | plan | rebalance [--execute]
const [cmd = 'plan', arg] = process.argv.slice(2);
const execute = process.argv.includes('--execute');
const ctx = context();
const out =
  cmd === 'market'
    ? await marketData(ctx)
    : cmd === 'portfolio'
      ? await portfolio(ctx, arg?.startsWith('0x') ? arg : undefined)
      : cmd === 'rebalance'
        ? await (async () => {
            const plan = await planRebalance(ctx);
            return { steps: plan.steps, results: await executePlan(ctx, plan, { confirm: execute }) };
          })()
        : await planRebalance(ctx);
console.log(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
