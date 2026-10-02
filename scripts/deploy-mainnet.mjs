import fs from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseUnits,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from './check-contracts.mjs';

// Phase 4: Orbit's own mainnet contracts. PLAN ONLY unless every gate below passes.
// Swap and lending on mainnet use Circle App Kit and protocol-operated vaults; Orbit
// deploys only what does not exist: a canonical Uniswap V2 factory/router for graduated
// launches (none is listed for Arc) and OrbitLaunch, paused, owned by a multisig.
const USDC = '0x3600000000000000000000000000000000000000';
const chain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
});
const rpc = createPublicClient({ chain, transport: http(undefined, { timeout: 20_000 }) });
const artifact = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const env = process.env;
const params = {
  virtualQuote: parseUnits(env.MAINNET_VIRTUAL_QUOTE_USDC || '5000', 6),
  feeBps: BigInt(env.MAINNET_FEE_BPS || '100'),
  maxGasUsdc: parseUnits(env.MAINNET_MAX_GAS_USDC || '3', 18),
};
const source = fs.readFileSync('contracts/src/OrbitLaunch.sol', 'utf8') + fs.readFileSync('contracts/src/OrbitToken.sol', 'utf8');
const sourceHash = keccak256(toHex(source));

const gates = [];
const gate = (ok, text) => gates.push({ ok: !!ok, text });

if ((await rpc.getChainId()) !== 5042) throw new Error('Not Arc mainnet');
const multisig = env.MAINNET_MULTISIG;
const multisigCode = multisig ? await rpc.getCode({ address: multisig }) : undefined;
gate(multisig && multisigCode && multisigCode !== '0x', `MAINNET_MULTISIG is a deployed contract (${multisig || 'unset'})`);
const key = env.MAINNET_DEPLOYER_PRIVATE_KEY;
const account = key && privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const testnetDeployer = (env.ARC_TESTNET_DEPLOYER_ADDRESS || '0x1a86d3148df478a1071e9d3d4825c99fb75ec964').toLowerCase();
gate(account, 'MAINNET_DEPLOYER_PRIVATE_KEY is set (a fresh key, not the testnet key)');
gate(account && account.address.toLowerCase() !== testnetDeployer, 'Deployer is not the testnet deployer');
gate(env.ORBIT_AUDITED_SOURCE_HASH === sourceHash, `ORBIT_AUDITED_SOURCE_HASH matches current source (${sourceHash})`);
gate(fs.existsSync(env.ORBIT_AUDIT_REPORT || '/nonexistent'), 'ORBIT_AUDIT_REPORT points to the audit report file');
gate(env.ORBIT_MAINNET_CONFIRM === 'deploy-orbit-mainnet', 'ORBIT_MAINNET_CONFIRM=deploy-orbit-mainnet');
gate(process.argv.includes('--broadcast'), '--broadcast flag');

// Gas estimate for the plan (deploy data only; does not need a funded key).
const own = compile();
const launchArtifact = own['contracts/src/OrbitLaunch.sol'].OrbitLaunch;
const factoryArtifact = artifact('node_modules/@uniswap/v2-core/build/UniswapV2Factory.json');
const routerArtifact = artifact('node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json');
const gasPrice = await rpc.getGasPrice();
const estimate = (bytecode) => BigInt(Math.ceil(bytecode.length / 2)) * 220n + 120_000n; // rough upper bound
const planGas = estimate(factoryArtifact.bytecode) + estimate(routerArtifact.bytecode) + estimate(launchArtifact.evm.bytecode.object) + 200_000n;
console.log('Orbit mainnet deployment plan');
console.log(`  1. UniswapV2Factory (canonical @uniswap/v2-core 1.0.1), feeToSetter = multisig`);
console.log(`  2. UniswapV2Router02 (canonical 1.1.0-beta.0) with WETH = USDC 0x3600… (Arc needs no wrapper; native-ETH router paths are unusable by design)`);
console.log(`  3. OrbitLaunch(USDC, router, virtualQuote ${formatUnits(params.virtualQuote, 6)} USDC, fee ${params.feeBps} bps, feeRecipient = multisig)`);
console.log(`     graduates at ≈ ${formatUnits((params.virtualQuote * 7931n) / 2799n, 6)} USDC raised`);
console.log(`  4. setLaunchesPaused(true), then transferOwnership(multisig); multisig must call acceptOwnership()`);
console.log(`  Estimated gas ≈ ${formatUnits(planGas * gasPrice, 18)} USDC at current price (cap ${formatUnits(params.maxGasUsdc, 18)})`);
console.log(`  Source hash: ${sourceHash}\n`);
for (const g of gates) console.log(`${g.ok ? '  ok  ' : '  todo'} ${g.text}`);
if (gates.some((g) => !g.ok)) {
  console.log('\nNot broadcasting: complete every gate above.');
  process.exit(0);
}

const wallet = createWalletClient({ account, chain, transport: http() });
if ((await rpc.getBalance({ address: account.address })) < planGas * gasPrice) throw new Error('Deployer cannot cover gas');
const record = { chainId: 5042, deployedAt: new Date().toISOString(), deployer: account.address, multisig, sourceHash, contracts: {}, transactions: [] };
let spent = 0n;
async function send(label, fn) {
  const hash = await fn();
  const r = await rpc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  spent += r.gasUsed * r.effectiveGasPrice;
  if (spent > params.maxGasUsdc) throw new Error('Gas cap exceeded; stop and reconcile');
  record.transactions.push({ label, hash, status: r.status });
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return r;
}
const deploy = async (name, abi, bytecode, args) => {
  const r = await send(`Deploy ${name}`, () =>
    wallet.deployContract({ abi, bytecode: bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`, args }),
  );
  const code = await rpc.getCode({ address: r.contractAddress });
  record.contracts[name] = { address: r.contractAddress, runtimeCodeHash: keccak256(code), constructorArgs: args.map(String) };
  return r.contractAddress;
};
const factory = await deploy('UniswapV2Factory', factoryArtifact.abi, factoryArtifact.bytecode, [multisig]);
const router = await deploy('UniswapV2Router02', routerArtifact.abi, routerArtifact.bytecode, [factory, USDC]);
const launch = await deploy('OrbitLaunch', launchArtifact.abi, launchArtifact.evm.bytecode.object, [USDC, router, params.virtualQuote, params.feeBps, multisig]);
const call = (functionName, args) =>
  send(functionName, () => wallet.writeContract({ address: launch, abi: launchArtifact.abi, functionName, args }));
await call('setLaunchesPaused', [true]);
await call('transferOwnership', [multisig]);
const manifest = JSON.parse(fs.readFileSync('deployments/arc-mainnet.json', 'utf8'));
manifest.orbit = record;
manifest.launch = { contract: launch, quote: USDC, quoteSymbol: 'USDC', virtualQuote: params.virtualQuote.toString(), feeBps: Number(params.feeBps), paused: true };
fs.writeFileSync('deployments/arc-mainnet.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nDeployed. Launches are PAUSED. Next: multisig calls acceptOwnership() on ${launch}, then setLaunchesPaused(false) when ready.`);
