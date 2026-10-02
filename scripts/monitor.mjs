import fs from 'node:fs';
import { createPublicClient, defineChain, erc20Abi, formatUnits, http, parseAbi } from 'viem';

// Phase 3 health checks for cron/CI. Read-only. Exit code 1 on any failure; posts a JSON
// summary to ALERT_WEBHOOK_URL (Slack/Discord-compatible "text" field) when something fails.
//   node scripts/monitor.mjs [testnet|mainnet]
const network = process.argv[2] === 'mainnet' ? 'mainnet' : 'testnet';
const cfg = {
  testnet: { id: 5042002, rpcs: ['https://rpc.testnet.arc.io', 'https://rpc.quicknode.testnet.arc.io', 'https://rpc.drpc.testnet.arc.io'], manifest: 'deployments/arc-testnet.json' },
  mainnet: { id: 5042, rpcs: ['https://rpc.mainnet.arc.io', 'https://rpc.quicknode.mainnet.arc.io', 'https://rpc.drpc.mainnet.arc.io'], manifest: 'deployments/arc-mainnet.json' },
}[network];
const chain = defineChain({ id: cfg.id, name: network, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: cfg.rpcs } } });
const results = [];
const check = async (name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - started });
  } catch (e) {
    results.push({ name, ok: false, detail: e.shortMessage || e.message, ms: Date.now() - started });
  }
};

for (const url of cfg.rpcs)
  await check(`rpc ${new URL(url).host}`, async () => {
    const c = createPublicClient({ chain, transport: http(url, { timeout: 8000 }) });
    if ((await c.getChainId()) !== cfg.id) throw new Error('wrong chain id');
    const block = await c.getBlock();
    const lag = Date.now() / 1000 - Number(block.timestamp);
    if (lag > 60) throw new Error(`head is ${lag.toFixed(0)}s old`);
    return `block ${block.number}, ${lag.toFixed(1)}s behind`;
  });

const rpc = createPublicClient({ chain, transport: http(cfg.rpcs[0], { timeout: 15000 }) });
const m = fs.existsSync(cfg.manifest) ? JSON.parse(fs.readFileSync(cfg.manifest, 'utf8')) : {};

if (m.launch?.contract) {
  const launch = m.launch.contract;
  const abi = parseAbi([
    'function tokenCount() view returns (uint256)',
    'function tokens(uint256) view returns (address)',
    'function feesAccrued() view returns (uint256)',
    'function launchesPaused() view returns (bool)',
    'function owner() view returns (address)',
    'function curveState(address) view returns ((bool graduated,uint256 virtualQuote,uint256 virtualToken,uint256 realQuote,uint256 tokensLeft))',
  ]);
  await check('launch solvency', async () => {
    const n = await rpc.readContract({ address: launch, abi, functionName: 'tokenCount' });
    let owed = await rpc.readContract({ address: launch, abi, functionName: 'feesAccrued' });
    for (let i = 0n; i < n; i++) {
      const t = await rpc.readContract({ address: launch, abi, functionName: 'tokens', args: [i] });
      owed += (await rpc.readContract({ address: launch, abi, functionName: 'curveState', args: [t] })).realQuote;
    }
    const held = await rpc.readContract({ address: m.launch.quote, abi: erc20Abi, functionName: 'balanceOf', args: [launch] });
    if (held < owed) throw new Error(`INSOLVENT: holds ${formatUnits(held, 6)} < owes ${formatUnits(owed, 6)}`);
    return `${n} curves, holds ${formatUnits(held, 6)} USDC = owes ${formatUnits(owed, 6)}`;
  });
  await check('launch admin', async () => {
    const [paused, owner] = await Promise.all([
      rpc.readContract({ address: launch, abi, functionName: 'launchesPaused' }),
      rpc.readContract({ address: launch, abi, functionName: 'owner' }),
    ]);
    const ownerCode = await rpc.getCode({ address: owner });
    if (network === 'mainnet' && (!ownerCode || ownerCode === '0x')) throw new Error(`owner ${owner} is an EOA, expected a multisig`);
    return `owner ${owner}${ownerCode && ownerCode !== '0x' ? ' (contract)' : ' (EOA)'}, launches ${paused ? 'paused' : 'open'}`;
  });
}

if (m.lending?.markets?.length) {
  const o = parseAbi(['function latestPrice() view returns (uint256,uint256,bool)']);
  await check('oracle freshness', async () => {
    const [, at, fresh] = await rpc.readContract({ address: m.lending.markets[0].oracle, abi: o, functionName: 'latestPrice' });
    const age = (Date.now() / 1000 - Number(at)) / 86400;
    if (!fresh) throw new Error(`stale (${age.toFixed(1)} days); run pnpm oracle:refresh --broadcast`);
    if (age > 25) throw new Error(`expires in ${(30 - age).toFixed(1)} days; refresh soon`);
    return `${age.toFixed(1)} days old`;
  });
}

if (process.env.ORBIT_AGENT_ADDRESS)
  await check('agent gas reserve', async () => {
    const gas = Number(formatUnits(await rpc.getBalance({ address: process.env.ORBIT_AGENT_ADDRESS }), 18));
    if (gas < 0.2) throw new Error(`agent wallet has ${gas} USDC`);
    return `${gas.toFixed(3)} USDC`;
  });

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail} (${r.ms}ms)`);
if (failed.length && process.env.ALERT_WEBHOOK_URL)
  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `Orbit ${network}: ${failed.map((f) => `${f.name}: ${f.detail}`).join('; ')}` }),
  }).catch(() => undefined);
process.exitCode = failed.length ? 1 : 0;
