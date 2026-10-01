import fs from 'node:fs';
import {
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  http,
  parseUnits,
  formatUnits,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from './check-contracts.mjs';
import { chain, rpc, loadDeployer } from './testnet-wallet.mjs';

// Testnet only. No private keys in environment variables, arguments, logs or manifests.
const outputDir = 'deployments';
const manifestPath = `${outputDir}/arc-testnet.json`;
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : {
      chainId: chain.id,
      network: chain.name,
      contracts: {},
      transactions: [],
      gasSpent: '0',
      steps: {},
    };
const maxBudget = parseUnits(process.env.DEPLOY_MAX_USDC || '5', 18);
function save() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
const artifact = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const prefix = (bytecode) => (bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`);
let account, wallet;
async function limits(data, to) {
  const gasPrice = await rpc.getGasPrice();
  const estimate = await rpc.estimateGas({ account: account.address, data, ...(to ? { to } : {}) });
  const gas = (estimate * 125n) / 100n;
  const cost = gas * gasPrice;
  if (BigInt(manifest.gasSpent) + cost > maxBudget)
    throw new Error(
      'Deployment gas budget exceeded. Review receipts before increasing DEPLOY_MAX_USDC.',
    );
  if ((await rpc.getBalance({ address: account.address })) < cost)
    throw new Error('Insufficient native testnet USDC for gas.');
  return { gas, gasPrice };
}
async function receipt(hash, label) {
  console.log(`${label}: ${hash}`);
  const tx = await rpc.waitForTransactionReceipt({ hash, timeout: 120000 });
  manifest.gasSpent = (BigInt(manifest.gasSpent) + tx.gasUsed * tx.effectiveGasPrice).toString();
  manifest.transactions.push({
    label,
    hash,
    status: tx.status,
    block: tx.blockNumber.toString(),
    gasUsed: tx.gasUsed.toString(),
    gasCost: (tx.gasUsed * tx.effectiveGasPrice).toString(),
  });
  save();
  if (tx.status !== 'success') throw new Error(`${label} reverted`);
  return tx;
}
async function deploy(name, source, args = []) {
  if (manifest.contracts[name]) {
    const address = manifest.contracts[name].address;
    if (!(await rpc.getCode({ address }))) throw new Error(`Recorded ${name} has no code`);
    return { address, abi: source.abi };
  }
  const bytecode = prefix(source.bytecode || source.evm.bytecode.object);
  const data = encodeDeployData({ abi: source.abi, bytecode, args });
  const fees = await limits(data);
  const hash = await wallet.deployContract({
    account,
    chain,
    abi: source.abi,
    bytecode,
    args,
    ...fees,
  });
  const tx = await receipt(hash, `Deploy ${name}`);
  const address = tx.contractAddress;
  const code = await rpc.getCode({ address });
  if (!code || code === '0x') throw new Error(`Missing runtime bytecode for ${name}`);
  manifest.contracts[name] = {
    address,
    transaction: hash,
    runtimeCodeHash: keccak256(code),
    constructorArgs: args.map((a) => (typeof a === 'bigint' ? a.toString() : a)),
  };
  save();
  return { address, abi: source.abi };
}
async function write(label, contract, functionName, args) {
  if (manifest.steps[label]) return;
  const data = encodeFunctionData({ abi: contract.abi, functionName, args });
  const fees = await limits(data, contract.address);
  const { request } = await rpc.simulateContract({
    ...contract,
    account,
    functionName,
    args,
    ...fees,
  });
  const hash = await wallet.writeContract({ ...request, account, chain });
  await receipt(hash, label);
  manifest.steps[label] = hash;
  save();
}
async function main() {
  if ((await rpc.getChainId()) !== chain.id) throw new Error('Wrong chain: refusing deployment');
  if (!process.argv.includes('--broadcast')) {
    console.log(
      'Plan: test tokens, canonical Uniswap V2 factory/router + wrapped native token, USDC/ETH liquidity, experimental launchpad. Run with --broadcast to send testnet transactions.',
    );
    return;
  }
  const deployer = await loadDeployer();
  account = privateKeyToAccount(deployer.privateKey);
  wallet = createWalletClient({ account, chain, transport: http() });
  if (manifest.deployer && manifest.deployer !== account.address)
    throw new Error('Manifest deployer mismatch');
  manifest.deployer = account.address;
  console.log(
    `Arc testnet deployer: ${account.address}. Cumulative gas cap: ${formatUnits(maxBudget, 18)} USDC.`,
  );
  if ((await rpc.getBalance({ address: account.address })) === 0n)
    throw new Error('Fund deployer with Arc testnet native USDC first');
  const compiled = compile({
    'contracts/src/TestnetToken.sol': {
      content: fs.readFileSync('contracts/src/TestnetToken.sol', 'utf8'),
    },
  });
  const tokenArtifact = compiled['contracts/src/TestnetToken.sol'].TestnetToken;
  const usdc = await deploy('TestUSDC', tokenArtifact, [
    'Orbit Test USD Coin (no value)',
    'tUSDC',
    6,
    parseUnits('10000000', 6),
    parseUnits('1000', 6),
  ]);
  const eth = await deploy('TestETH', tokenArtifact, [
    'Orbit Test Ether (no value)',
    'tETH',
    18,
    parseUnits('100000', 18),
    parseUnits('1', 18),
  ]);
  const saleToken = await deploy('TestORBIT', tokenArtifact, [
    'Orbit Test Sale Token (no value)',
    'tORBIT',
    18,
    parseUnits('1000000', 18),
    parseUnits('100', 18),
  ]);
  const factory = await deploy(
    'UniswapV2Factory',
    artifact('node_modules/@uniswap/v2-core/build/UniswapV2Factory.json'),
    [account.address],
  );
  // Legacy canonical WETH9 bytecode wraps the native gas token (USDC on Arc), NOT ETH.
  // It is required by Router02 constructor; UI exposes ERC20-to-ERC20 swaps only.
  const wrapped = await deploy(
    'WrappedNativeUSDC',
    artifact('node_modules/@uniswap/v2-periphery/build/WETH9.json'),
  );
  const router = await deploy(
    'UniswapV2Router02',
    artifact('node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json'),
    [factory.address, wrapped.address],
  );
  const amountUSDC = parseUnits('268432', 6),
    amountETH = parseUnits('100', 18);
  await write('Approve initial tUSDC liquidity', usdc, 'approve', [router.address, amountUSDC]);
  await write('Approve initial tETH liquidity', eth, 'approve', [router.address, amountETH]);
  const block = await rpc.getBlock();
  await write('Seed tUSDC-tETH pool', router, 'addLiquidity', [
    usdc.address,
    eth.address,
    amountUSDC,
    amountETH,
    amountUSDC,
    amountETH,
    account.address,
    block.timestamp + 600n,
  ]);
  const pairAddress = await rpc.readContract({
    ...factory,
    functionName: 'getPair',
    args: [usdc.address, eth.address],
  });
  manifest.pool = {
    address: pairAddress,
    token0: usdc.address,
    token1: eth.address,
    seededUSDC: '268432',
    seededETH: '100',
    fixtureLiquidity: true,
  };
  // Persist schedule before deployment so resuming keeps constructor arguments stable.
  if (!manifest.sale)
    manifest.sale = {
      start: (block.timestamp + 300n).toString(),
      end: (block.timestamp + 7n * 86400n).toString(),
      softCap: parseUnits('1000', 6).toString(),
      hardCap: parseUnits('200000', 6).toString(),
      rate: (2n * 10n ** 30n).toString(),
    };
  save();
  const p = manifest.sale;
  const launchpad = await deploy(
    'FixedPriceLaunchpad',
    compiled['contracts/src/FixedPriceLaunchpad.sol'].FixedPriceLaunchpad,
    [
      account.address,
      usdc.address,
      saleToken.address,
      BigInt(p.start),
      BigInt(p.end),
      BigInt(p.softCap),
      BigInt(p.hardCap),
      BigInt(p.rate),
    ],
  );
  await write('Fund full launchpad inventory', saleToken, 'transfer', [
    launchpad.address,
    parseUnits('400000', 18),
  ]);
  manifest.completedAt = new Date().toISOString();
  manifest.liveExecutionEnabled = true;
  manifest.capabilities = { testTokenSwaps: true, testSale: true, lending: false, mainnet: false };
  manifest.warning =
    'Testnet only. All t* assets are freely minted, valueless test tokens. Launchpad unaudited; no Aave lending deployment. WrappedNativeUSDC uses legacy WETH9 metadata but wraps native USDC.';
  save();
  fs.mkdirSync('public', { recursive: true });
  fs.writeFileSync('public/arc-testnet-deployment.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `Deployment complete. Manifest: ${manifestPath}. Gas spent: ${formatUnits(BigInt(manifest.gasSpent), 18)} native testnet USDC.`,
  );
}
main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
