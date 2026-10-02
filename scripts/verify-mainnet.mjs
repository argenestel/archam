import fs from 'node:fs';
import { createPublicClient, defineChain, erc20Abi, http, keccak256, parseAbi } from 'viem';
import { AppKit } from '@circle-fin/app-kit';

// Phase 0 (read-only): verify every mainnet dependency on-chain and record it in
// deployments/arc-mainnet.json. No keys, no transactions. Sources: docs.arc.io contract
// addresses (Circle assets, infra, ERC-8004), Circle App Kit discovery (Earn vaults, Swap),
// Uniswap's Arc playbook (v4 PoolManager). Anything not confirmed is listed as missing.
const chain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
});
const rpc = createPublicClient({ chain, transport: http(undefined, { timeout: 20_000 }) });
const expected = {
  circle: {
    USDC: { address: '0x3600000000000000000000000000000000000000', symbol: 'USDC', decimals: 6 },
    EURC: { address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', symbol: 'EURC', decimals: 6 },
    cirBTC: { address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
    WETH: { address: '0x128cC466B61f542da60c70e3aA11c10e19B84EDB', decimals: 18 },
  },
  infra: {
    Permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
    Create2Factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
    Memo: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
    Multicall3From: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
    StableFxEscrow: '0xe2E5F173576B513d994073CCbDaCBE027d43DFe6',
    ERC8004IdentityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    ERC8004ReputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    ERC8004ValidationRegistry: '0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58',
    // Safe (canonical deterministic deployments) for the multisig owner / fee recipient.
    SafeProxyFactory141: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
    SafeL2_141: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  },
  protocols: {
    // Official Uniswap v4 deployment registry, Arc chain 5042:
    // https://developers.uniswap.org/docs/protocols/v4/deployments
    UniswapV4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    UniswapUniversalRouter: '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1',
    UniswapUniversalRouter212: '0x8702463e73f74d0b6765abceb314ef07acb92650',
    UniswapV4PositionManager: '0x6049c9a0e26405c0985f9e3685c87d0ae917f82b',
    UniswapV4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    UniswapV4StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  },
};
// Preserve durable custom deployments when refreshing replaceable ecosystem discovery.
const previous = JSON.parse(fs.readFileSync('deployments/arc-mainnet.json', 'utf8'));
const report = {
  ...(previous.orbit ? { orbit: previous.orbit } : {}),
  ...(previous.mofu ? { mofu: previous.mofu } : {}),
  ...(previous.launch ? { launch: previous.launch } : {}),
  chainId: 5042,
  network: 'Arc',
  verifiedAt: new Date().toISOString(),
  sources: [
    'https://docs.arc.io/arc/references/contract-addresses',
    'https://developers.uniswap.org/docs/protocols/v4/deployments',
    'Circle App Kit live Earn and Borrow discovery',
  ],
  contracts: {},
  missing: [],
  notes: [],
};
const fail = (m) => {
  report.missing.push(m);
  console.log(`MISSING ${m}`);
};

async function code(name, address) {
  const c = await rpc.getCode({ address });
  if (!c || c === '0x') return fail(`${name}: no code at ${address}`);
  report.contracts[name] = { address, runtimeCodeHash: keccak256(c), bytes: (c.length - 2) / 2 };
  console.log(`ok      ${name} ${address} (${(c.length - 2) / 2} bytes)`);
  return c;
}

if ((await rpc.getChainId()) !== 5042) throw new Error('RPC is not Arc mainnet');
for (const [name, t] of Object.entries(expected.circle)) {
  // USDC is a system precompile-backed interface; check it via ERC-20 calls rather than code.
  const decimals = await rpc
    .readContract({ address: t.address, abi: erc20Abi, functionName: 'decimals' })
    .catch(() => undefined);
  if (decimals !== t.decimals) fail(`${name}: decimals ${decimals} != ${t.decimals}`);
  else {
    report.contracts[name] = { address: t.address, decimals };
    console.log(`ok      ${name} ${t.address} decimals=${decimals}`);
  }
}
for (const [name, address] of Object.entries({ ...expected.infra, ...expected.protocols }))
  await code(name, address);

// Circle App Kit: the official swap / earn / borrow integration on Arc.
const kit = new AppKit();
const { vaults = [] } = await kit.earn
  .exploreVaults({ chain: 'Arc', sortBy: 'apy' })
  .catch((e) => (fail(`App Kit Earn: ${e.message}`), {}));
report.earnVaults = [];
for (const v of vaults) {
  const c = await rpc.getCode({ address: v.vaultAddress });
  if (!c || c === '0x') {
    fail(`Earn vault ${v.name}: no code`);
    continue;
  }
  report.earnVaults.push({
    name: v.name,
    address: v.vaultAddress,
    protocol: v.protocol,
    asset: v.asset,
    apy: v.currentApy,
    tvl: v.totalDeposits,
    warnings: [...(v.riskSignals?.warnings || []), ...(v.riskSignals?.earnKitWarnings || [])],
    runtimeCodeHash: keccak256(c),
  });
  console.log(
    `ok      Earn vault ${v.name} (${v.protocol}) ${(v.currentApy * 100).toFixed(2)}% APY`,
  );
}
const rates = await kit
  .getTokenRates({ chain: 'Arc' })
  .catch((e) => (fail(`App Kit rates: ${e.message}`), undefined));
if (rates)
  report.notes.push(
    `App Kit token rates available for ${Object.keys(rates.rates?.Arc || {}).length} tokens`,
  );
report.swap = { provider: 'Circle App Kit', tokens: ['USDC', 'EURC', 'cirBTC'] };
report.borrow = {
  provider: 'Circle App Kit Borrow',
  supported: kit.getSupportedChains('borrow').some((c) => c.name === 'Arc'),
};
report.borrowMarkets = [];
try {
  for await (const market of kit.borrow.exploreMarketsIterator({ chain: 'Arc', pageSize: 100 })) {
    report.borrowMarkets.push(market);
    if (report.borrowMarkets.length >= 500) throw new Error('Discovery exceeded 500 market limit');
  }
} catch (e) {
  fail(`App Kit Borrow discovery: ${e.message}`);
}
report.notes.push(
  'Swap support is declared by the SDK. Token rates and deployed code do not prove a route exists for any given amount; the UI requires a live quote.',
);

// Uniswap V2: not listed in Arc docs or the Uniswap Arc playbook. Graduation needs a V2-style
// pair factory, so a mainnet launch must either deploy the canonical V2 factory (as on testnet)
// or switch graduation to Uniswap v4 (PoolManager above).
report.notes.push(
  'No Uniswap V2 deployment is listed by Arc or Uniswap for chain 5042 (checked 2026-10-02).',
);
const sanity = parseAbi(['function owner() view returns (address)']);
await rpc
  .readContract({
    address: expected.protocols.UniswapV4PoolManager,
    abi: sanity,
    functionName: 'owner',
  })
  .then((o) => report.notes.push(`Uniswap v4 PoolManager owner ${o}`))
  .catch(() => undefined);

fs.writeFileSync('deployments/arc-mainnet.json', JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync('public/arc-mainnet-deployment.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  `\nWrote deployments/arc-mainnet.json: ${Object.keys(report.contracts).length} contracts, ${report.earnVaults.length} vaults, ${report.missing.length} missing.`,
);
if (report.missing.length) process.exitCode = 1;
