import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AppKit } from '@circle-fin/app-kit';
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';
import { authorize, loadPolicy, record } from './policy.mjs';

// Orbit fund manager: the data + execution layer an AI agent (Claude Code, Codex, any MCP
// client) drives. Reads are free; every write passes the policy engine and is logged.

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const NETWORKS = {
  testnet: {
    id: 5042002,
    name: 'Arc Testnet',
    rpc: 'https://rpc.testnet.arc.io',
    kitChain: 'Arc_Testnet',
    eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    explorer: 'https://explorer.testnet.arc.io',
  },
  mainnet: {
    id: 5042,
    name: 'Arc',
    rpc: 'https://rpc.mainnet.arc.io',
    kitChain: 'Arc',
    eurc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    explorer: 'https://explorer.arc.io',
  },
};
export const USDC = '0x3600000000000000000000000000000000000000';

export function context() {
  const policy = loadPolicy();
  const net = NETWORKS[policy.network];
  if (!net) throw new Error(`Unknown network ${policy.network}`);
  const chain = defineChain({
    id: net.id,
    name: net.name,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [net.rpc] } },
  });
  const pub = createPublicClient({ chain, transport: http(net.rpc, { timeout: 20_000 }) });
  const key = process.env.ORBIT_AGENT_PRIVATE_KEY;
  const account = key ? privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`) : undefined;
  const deployer = (process.env.ARC_TESTNET_DEPLOYER_ADDRESS || '').toLowerCase();
  if (account && deployer && account.address.toLowerCase() === deployer)
    throw new Error('Refusing to run the agent with the deployer key. Use a dedicated agent wallet.');
  const wallet = account && createWalletClient({ account, chain, transport: http(net.rpc) });
  const adapter = key ? createViemAdapterFromPrivateKey({ privateKey: account && (key.startsWith('0x') ? key : `0x${key}`) }) : undefined;
  const manifestPath = path.join(repo, 'deployments', policy.network === 'mainnet' ? 'arc-mainnet.json' : 'arc-testnet.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  return { policy, net, chain, pub, account, wallet, adapter, manifest, kit: new AppKit() };
}

const kitConfig = () => (process.env.CIRCLE_API_KEY ? { apiKey: process.env.CIRCLE_API_KEY } : undefined);
const json = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

// ------------------------------------------------------------------ reads

export async function marketData(ctx) {
  const { kit, net, pub, manifest } = ctx;
  const [rates, vaults] = await Promise.all([
    kit.getTokenRates({ chain: net.kitChain }).catch((e) => ({ error: e.message })),
    kit.earn.exploreVaults({ chain: net.kitChain, sortBy: 'apy' }).catch((e) => ({ error: e.message, vaults: [] })),
  ]);
  const out = {
    network: net.name,
    asOf: new Date().toISOString(),
    tokenPricesUsd: rates.rates?.[net.kitChain]
      ? Object.fromEntries(
          Object.entries(rates.rates[net.kitChain]).map(([a, r]) => [a.toLowerCase() === USDC ? 'USDC' : a.toLowerCase() === net.eurc.toLowerCase() ? 'EURC' : a, Number(r.priceUSD)]),
        )
      : rates,
    earnVaults: (vaults.vaults || []).map((v) => ({
      vault: v.vaultAddress,
      name: v.name,
      protocol: v.protocol,
      asset: v.asset,
      apy: v.currentApy,
      status: v.status,
      liquidity: Number(v.liquidity),
      totalDeposits: Number(v.totalDeposits),
      warnings: [...(v.riskSignals?.warnings || []), ...(v.riskSignals?.earnKitWarnings || [])],
    })),
  };
  const market = manifest.lending?.markets?.[0];
  if (market) {
    const morphoAbi = parseAbi([
      'function market(bytes32) view returns (uint128,uint128,uint128,uint128,uint128,uint128)',
    ]);
    const m = await pub.readContract({ address: manifest.lending.morpho, abi: morphoAbi, functionName: 'market', args: [market.id] });
    out.orbitMorphoMarket = {
      label: market.label,
      loanToken: 'tUSDC (test asset)',
      totalSupply: Number(formatUnits(m[0], 6)),
      totalBorrow: Number(formatUnits(m[2], 6)),
      utilization: m[0] ? Number(m[2]) / Number(m[0]) : 0,
    };
  }
  return out;
}

export async function portfolio(ctx, address) {
  const { pub, net, kit, adapter } = ctx;
  const who = address || ctx.account?.address;
  if (!who) throw new Error('No address given and ORBIT_AGENT_PRIVATE_KEY is not set.');
  const [gas, usdc, eurc] = await Promise.all([
    pub.getBalance({ address: who }),
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [who] }),
    pub.readContract({ address: net.eurc, abi: erc20Abi, functionName: 'balanceOf', args: [who] }),
  ]);
  const positions = [];
  if (adapter && (!address || address.toLowerCase() === ctx.account.address.toLowerCase())) {
    const { vaults = [] } = await kit.earn.exploreVaults({ chain: net.kitChain }).catch(() => ({}));
    for (const v of vaults) {
      const p = await kit.earn
        .getPosition({ from: { adapter, chain: net.kitChain }, vaultAddress: v.vaultAddress })
        .catch(() => undefined);
      const balance = Number(p?.currentBalance?.amount ?? p?.currentBalance ?? 0);
      if (balance > 0) positions.push({ vault: v.vaultAddress, name: v.name, apy: v.currentApy, balanceUsdc: balance, shares: p.shares });
    }
  }
  return {
    address: who,
    network: net.name,
    gasUsdc: Number(formatUnits(gas, 18)),
    wallet: { USDC: Number(formatUnits(usdc, 6)), EURC: Number(formatUnits(eurc, 6)) },
    earnPositions: positions,
  };
}

// ------------------------------------------------------------------ writes (policy-gated)

function requireSigner(ctx) {
  if (!ctx.adapter || !ctx.wallet) throw new Error('Set ORBIT_AGENT_PRIVATE_KEY to a dedicated agent wallet to act.');
}
async function gasUsdc(ctx) {
  return Number(formatUnits(await ctx.pub.getBalance({ address: ctx.account.address }), 18));
}
async function usdValue(ctx, token, amount) {
  if (token === 'USDC') return Number(amount);
  const r = await ctx.kit.getTokenRates({ chain: ctx.net.kitChain });
  const addr = token === 'EURC' ? ctx.net.eurc.toLowerCase() : token;
  const price = Number(Object.entries(r.rates[ctx.net.kitChain]).find(([a]) => a.toLowerCase() === addr)?.[1]?.priceUSD);
  if (!price) throw new Error(`No USD price for ${token}`);
  return Number(amount) * price;
}

async function guarded(ctx, intent, run, { confirm, reason }) {
  requireSigner(ctx);
  const { dryRun } = authorize(ctx.policy, intent, await gasUsdc(ctx));
  if (dryRun || !confirm) {
    const entry = { ...intent, status: 'simulated', reason, note: dryRun ? 'policy dryRun=true' : 'confirm=false' };
    record(entry);
    return entry;
  }
  try {
    const result = json(await run());
    record({ ...intent, status: 'executed', reason, result });
    return { ...intent, status: 'executed', result };
  } catch (e) {
    record({ ...intent, status: 'failed', reason, error: e.message });
    throw e;
  }
}

export async function quoteSwap(ctx, { tokenIn, tokenOut, amountIn }) {
  requireSigner(ctx);
  return json(
    await ctx.kit.estimateSwap({ from: { adapter: ctx.adapter, chain: ctx.net.kitChain }, tokenIn, tokenOut, amountIn, config: kitConfig() }),
  );
}

export async function swap(ctx, { tokenIn, tokenOut, amountIn, slippageBps = 50, confirm, reason }) {
  const usd = await usdValue(ctx, tokenIn, amountIn);
  return guarded(
    ctx,
    { action: 'swap', token: tokenIn, tokenOut, amount: amountIn, usd, slippageBps },
    () =>
      ctx.kit.swap({
        from: { adapter: ctx.adapter, chain: ctx.net.kitChain },
        tokenIn,
        tokenOut,
        amountIn,
        config: { ...kitConfig(), slippageBps },
      }),
    { confirm, reason },
  );
}

export async function earnDeposit(ctx, { vault, amount, confirm, reason }) {
  return guarded(
    ctx,
    { action: 'earn_deposit', token: 'USDC', vault, amount, usd: Number(amount) },
    () => ctx.kit.earn.deposit({ from: { adapter: ctx.adapter, chain: ctx.net.kitChain }, vaultAddress: vault, amount, config: kitConfig() }),
    { confirm, reason },
  );
}

export async function earnWithdraw(ctx, { vault, amount, confirm, reason }) {
  return guarded(
    ctx,
    { action: 'earn_withdraw', token: 'USDC', vault, amount, usd: Number(amount) },
    () => ctx.kit.earn.withdraw({ from: { adapter: ctx.adapter, chain: ctx.net.kitChain }, vaultAddress: vault, amount, config: kitConfig() }),
    { confirm, reason },
  );
}

// ------------------------------------------------------------------ strategy

/**
 * Deterministic yield plan: keep a gas reserve in USDC, put idle USDC into the best
 * active vault without risk warnings, and move between vaults only when the APY gap
 * beats `minApyImprovementBps`. The agent may propose other plans; this is the baseline.
 */
export async function planRebalance(ctx) {
  const [data, book] = await Promise.all([marketData(ctx), portfolio(ctx)]);
  const p = ctx.policy;
  const eligible = data.earnVaults
    .filter((v) => v.asset === 'USDC' && v.status === 'active' && !v.warnings.length)
    .filter((v) => !p.vaultAllowlist.length || p.vaultAllowlist.map((a) => a.toLowerCase()).includes(v.vault.toLowerCase()))
    .sort((a, b) => b.apy - a.apy);
  const best = eligible[0];
  const steps = [];
  if (!best) return { steps, note: 'No eligible vault.', data, portfolio: book };
  // Wallet USDC and gas are the same balance on Arc; always leave the reserve behind.
  const idle = Math.floor((book.wallet.USDC - p.minGasReserveUsdc) * 100) / 100;
  const cap = (x) => Math.min(x, p.maxPerTxUsd);
  for (const pos of book.earnPositions) {
    if (pos.vault.toLowerCase() === best.vault.toLowerCase()) continue;
    const gapBps = Math.round((best.apy - (pos.apy ?? 0)) * 10_000);
    if (gapBps >= p.minApyImprovementBps && pos.balanceUsdc >= p.minMoveUsd) {
      const amount = cap(Math.floor(pos.balanceUsdc * 100) / 100).toFixed(2);
      steps.push({ tool: 'earn_withdraw', args: { vault: pos.vault, amount }, why: `${gapBps} bps better APY in ${best.name}` });
      steps.push({ tool: 'earn_deposit', args: { vault: best.vault, amount }, why: 'redeploy into best vault' });
    }
  }
  if (idle >= p.minMoveUsd)
    steps.push({
      tool: 'earn_deposit',
      args: { vault: best.vault, amount: cap(idle).toFixed(2) },
      why: `idle USDC to ${best.name} at ${(best.apy * 100).toFixed(2)}% APY, keeping ${p.minGasReserveUsdc} USDC for gas`,
    });
  return { best: { vault: best.vault, name: best.name, apy: best.apy }, steps, portfolio: book };
}

export async function executePlan(ctx, plan, { confirm }) {
  const results = [];
  for (const s of plan.steps) {
    const fn = s.tool === 'earn_deposit' ? earnDeposit : s.tool === 'earn_withdraw' ? earnWithdraw : s.tool === 'swap' ? swap : undefined;
    if (!fn) throw new Error(`Unknown step ${s.tool}`);
    results.push(await fn(ctx, { ...s.args, confirm, reason: s.why }));
  }
  return results;
}

export { parseUnits, keccak256, encodeAbiParameters };
