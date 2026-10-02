import fs from 'node:fs';
import crypto from 'node:crypto';
import solc from 'solc';
import {
  createPublicClient, defineChain, encodeDeployData, encodeFunctionData, erc20Abi,
  formatUnits, getContractAddress, http, keccak256, parseUnits, toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from './check-contracts.mjs';
import { atomicJson, journaledSend, spentGas, assertRuntime } from './lib/deployment-journal.mjs';

// Explicit EOA-owned, UNAUDITED hackathon release. Never populates production audit flags.
const chain = defineChain({ id: 5042, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } } });
const rpc = createPublicClient({ chain, transport: http(undefined, { timeout: 20_000 }) });
const USDC = '0x3600000000000000000000000000000000000000';
const env = process.env;
const rawKey = env.MAINNET_DEPLOYER_PRIVATE_KEY;
if (!rawKey) throw new Error('Set the local mainnet deployer key');
const account = privateKeyToAccount(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
if (account.address.toLowerCase() !== (env.MAINNET_DEPLOYER_ADDRESS || '').toLowerCase()) throw new Error('Deployer address/key mismatch');
if (account.address.toLowerCase() === (env.ARC_TESTNET_DEPLOYER_ADDRESS || '0x1a86d3148df478a1071e9d3d4825c99fb75ec964').toLowerCase()) throw new Error('Refusing testnet key');
if (await rpc.getChainId() !== 5042) throw new Error('Not Arc mainnet');
if (await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' }) !== 6) throw new Error('Unexpected USDC interface');
if (!solc.version().startsWith('0.8.30+')) throw new Error('Release requires pinned solc 0.8.30');
const virtualQuote = parseUnits(env.MAINNET_VIRTUAL_QUOTE_USDC || '5000', 6);
const feeBps = BigInt(env.MAINNET_FEE_BPS || '100');
const budget = parseUnits(env.MAINNET_HACKATHON_MAX_GAS_USDC || '0.75', 18);
const reserve = parseUnits('0.05', 18);
if (virtualQuote <= 0n || feeBps < 0n || feeBps > 200n || budget <= 0n || budget > parseUnits('1', 18)) throw new Error('Invalid parameters or hackathon cap above 1 USDC');
const artifact = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const factoryArtifact = artifact('node_modules/@uniswap/v2-core/build/UniswapV2Factory.json');
const routerArtifact = artifact('node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json');
const launchArtifact = compile()['contracts/src/MofuLaunch.sol'].MofuLaunch;
const launchBytecode = `0x${launchArtifact.evm.bytecode.object}`;
const sourceHash = keccak256(toHex(fs.readFileSync('contracts/src/MofuLaunch.sol', 'utf8') + fs.readFileSync('contracts/src/MofuToken.sol', 'utf8')));
const release = {
  chainId: 5042, deployer: account.address, virtualQuote: virtualQuote.toString(), feeBps: feeBps.toString(),
  budget: budget.toString(), sourceHash, compiler: solc.version(), optimizerRuns: 200, evmVersion: 'paris',
  lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync('pnpm-lock.yaml')).digest('hex'),
  initCodeHashes: [factoryArtifact.bytecode, routerArtifact.bytecode, launchBytecode].map((code) => keccak256(code)),
};
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(release)).digest('hex');
const journalFile = 'storage/mainnet-deployment.json'; // git-ignored; includes signed raw transactions
if (process.argv.includes('--broadcast')) {
  fs.mkdirSync('storage', { recursive: true });
  const lockFile = 'storage/mainnet-deployment.lock';
  const fd = fs.openSync(lockFile, 'wx', 0o600); // Stale lock requires manual reconciliation.
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  fs.fsyncSync(fd); fs.closeSync(fd);
  process.once('exit', () => fs.unlinkSync(lockFile));
  process.once('SIGINT', () => process.exit(130));
  process.once('SIGTERM', () => process.exit(143));
}
let journal = fs.existsSync(journalFile) ? artifact(journalFile) : undefined;
if (journal && journal.fingerprint !== fingerprint) throw new Error('Release differs from existing journal; reconcile, never overwrite');
const latestNonce = await rpc.getTransactionCount({ address: account.address });
const pendingNonce = await rpc.getTransactionCount({ address: account.address, blockTag: 'pending' });
if (!journal && (latestNonce !== 0 || pendingNonce !== 0)) throw new Error('Fresh deployment expects nonce 0; reconcile existing activity first');
const startNonce = journal?.startNonce ?? latestNonce;
const predicted = [0, 1, 2].map((i) => getContractAddress({ from: account.address, nonce: BigInt(startNonce + i) }));
const definitions = [
  ['UniswapV2Factory', factoryArtifact, [account.address]],
  ['UniswapV2Router02', routerArtifact, [predicted[0], USDC]],
  ['MofuLaunch', { ...launchArtifact, bytecode: launchBytecode }, [USDC, predicted[1], virtualQuote, feeBps, account.address]],
];
const gasPrice = await rpc.getGasPrice() * 2n;
let plannedMaximum = 100_000n * gasPrice; // activation reserve
for (const [, a, args] of definitions) {
  const data = encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args });
  plannedMaximum += (await rpc.estimateGas({ account: account.address, data }) * 130n + 99n) / 100n * gasPrice;
}
const balance = await rpc.getBalance({ address: account.address });
console.log(`UNAUDITED HACKATHON — owner/fee recipient ${account.address}`);
console.log(`Balance ${formatUnits(balance, 18)} USDC; nonces ${latestNonce}/${pendingNonce}; lifetime gas cap ${formatUnits(budget, 18)} USDC`);
console.log(`Conservative deployment/activation plan ${formatUnits(plannedMaximum, 18)} USDC; quote reserve ${formatUnits(virtualQuote, 6)} USDC; fee ${feeBps} bps`);
console.log(`Factory ${predicted[0]}\nRouter ${predicted[1]}\nMofuLaunch ${predicted[2]}\nSource ${sourceHash}`);
if (!process.argv.includes('--broadcast')) { console.log('Plan only. Requires --hackathon --broadcast and MAINNET_HACKATHON_CONFIRM=deploy-mofu-mainnet-unaudited'); }
else {
  if (env.MAINNET_HACKATHON_CONFIRM !== 'deploy-mofu-mainnet-unaudited') throw new Error('Explicit unaudited confirmation required');
  if (!journal && (plannedMaximum > budget || plannedMaximum + reserve > balance)) throw new Error('Plan exceeds budget or balance reserve');
  journal ||= { ...release, fingerprint, startNonce, createdAt: new Date().toISOString(), steps: [], record: {
    chainId: 5042, deployedAt: new Date().toISOString(), deployer: account.address, owner: account.address,
    feeRecipient: account.address, mode: 'hackathon', auditStatus: 'unaudited', phase: 'deploying',
    sourceHash, release, contracts: {}, transactions: [],
  } };
  const save = () => atomicJson(journalFile, journal);
  save();
  const record = journal.record;
  const publish = () => {
    record.transactions = journal.steps.map(({ raw, ...step }) => step);
    record.gasSpent = spentGas(journal).toString();
    const manifest = artifact('deployments/arc-mainnet.json');
    manifest.mofu = record;
    if (record.contracts.MofuLaunch) manifest.launch = {
      contract: record.contracts.MofuLaunch.address, quote: USDC, quoteSymbol: 'USDC',
      virtualQuote: virtualQuote.toString(), feeBps: Number(feeBps), paused: record.phase !== 'active',
      auditStatus: 'unaudited', totalSupply: (793_100_000n * 10n ** 18n + 279_900_000n * 10n ** 18n * 793_100_000n / 1_073_000_000n).toString(),
    };
    atomicJson('deployments/arc-mainnet.json', manifest, 0o644);
    atomicJson('public/arc-mainnet-deployment.json', manifest, 0o644);
  };
  for (const [i, [name, a, args]] of definitions.entries()) {
    const receipt = await journaledSend({ rpc, account, journal, save, budget, reserve, label: `Deploy ${name}`, transaction: { data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }) } });
    if (receipt.contractAddress?.toLowerCase() !== predicted[i].toLowerCase()) throw new Error('Deployment address mismatch');
    const code = await rpc.getCode({ address: predicted[i] });
    if (!code || code === '0x') throw new Error(`${name}: missing runtime code`);
    assertRuntime(code, a.evm.deployedBytecode);
    const runtimeCodeHash = keccak256(code);
    const old = record.contracts[name];
    if (old && old.runtimeCodeHash !== runtimeCodeHash) throw new Error(`${name}: runtime changed`);
    record.contracts[name] = { address: predicted[i], transaction: receipt.transactionHash, block: receipt.blockNumber.toString(), runtimeCodeHash, constructorArgs: args.map(String) };
    save(); publish();
    console.log(`Verified ${name}: ${predicted[i]} (${receipt.transactionHash})`);
  }
  const read = (index, functionName) => rpc.readContract({ address: predicted[index], abi: definitions[index][1].abi, functionName });
  const equal = async (index, fn, expected) => {
    const actual = await read(index, fn);
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${fn}: constructor/state mismatch`);
  };
  await equal(0, 'feeToSetter', account.address);
  await equal(1, 'factory', predicted[0]);
  await equal(1, 'WETH', USDC);
  await equal(2, 'owner', account.address);
  await equal(2, 'feeRecipient', account.address);
  await equal(2, 'quote', USDC);
  await equal(2, 'router', predicted[1]);
  await equal(2, 'initialVirtualQuote', virtualQuote);
  await equal(2, 'feeBps', feeBps);
  await equal(2, 'TOTAL_SUPPLY', 793_100_000n * 10n ** 18n + 279_900_000n * 10n ** 18n * 793_100_000n / 1_073_000_000n);
  await equal(2, 'lpSupply', 279_900_000n * 10n ** 18n * 793_100_000n / 1_073_000_000n);
  if (!journal.steps.some((s) => s.label === 'Enable launches')) await equal(2, 'launchesPaused', true);
  record.phase = 'verified-paused'; save(); publish();
  // Public launch enablement is a separate, bounded, journaled transaction after verification.
  const enabled = await journaledSend({ rpc, account, journal, save, budget, reserve, label: 'Enable launches', transaction: { to: predicted[2], data: encodeFunctionData({ abi: launchArtifact.abi, functionName: 'setLaunchesPaused', args: [false] }) } });
  await equal(2, 'launchesPaused', false);
  record.phase = 'active'; record.verifiedAt = new Date().toISOString(); save(); publish();
  console.log(`ACTIVE, UNAUDITED: ${predicted[2]}; activation ${enabled.transactionHash}; gas spent ${formatUnits(spentGas(journal), 18)} USDC`);
}
