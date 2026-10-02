import fs from 'node:fs';
import {
  createWalletClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile, compileMorpho } from './check-contracts.mjs';
import { chain, rpc, loadDeployer } from './testnet-wallet.mjs';

// Phase 2 testnet deployment: canonical Morpho Blue lending + Orbit launch curves.
// Testnet only. The key is read from the git-ignored .env (ARC_TESTNET_DEPLOYER_PRIVATE_KEY)
// or the encrypted keystore, and is never printed, logged, or written to the manifest.
const manifestPath = 'deployments/arc-testnet.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.steps ||= {};
const maxBudget = parseUnits(process.env.DEPLOY_MAX_USDC || '5', 18);
const USDC_ERC20 = '0x3600000000000000000000000000000000000000';
const LLTV = 860000000000000000n;
const save = () => {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync('public/arc-testnet-deployment.json', JSON.stringify(manifest, null, 2) + '\n');
};
let account, wallet;

function envKey() {
  if (process.env.ARC_TESTNET_DEPLOYER_PRIVATE_KEY) return process.env.ARC_TESTNET_DEPLOYER_PRIVATE_KEY;
  if (!fs.existsSync('.env')) return undefined;
  const line = fs
    .readFileSync('.env', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('ARC_TESTNET_DEPLOYER_PRIVATE_KEY='));
  return line?.split('=')[1]?.trim() || undefined;
}
async function signer() {
  const raw = envKey();
  if (raw) return privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`);
  return privateKeyToAccount((await loadDeployer()).privateKey);
}
async function limits(data, to) {
  const gasPrice = await rpc.getGasPrice();
  const estimate = await rpc.estimateGas({ account: account.address, data, ...(to ? { to } : {}) });
  const gas = (estimate * 130n) / 100n;
  const cost = gas * gasPrice;
  if (BigInt(manifest.gasSpent) + cost > maxBudget)
    throw new Error('Deployment gas budget exceeded. Review receipts before raising DEPLOY_MAX_USDC.');
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
  if (manifest.contracts[name]) return { address: manifest.contracts[name].address, abi: source.abi };
  const bytecode = `0x${source.evm.bytecode.object}`;
  const data = encodeDeployData({ abi: source.abi, bytecode, args });
  const fees = await limits(data);
  const hash = await wallet.deployContract({ abi: source.abi, bytecode, args, ...fees });
  const tx = await receipt(hash, `Deploy ${name}`);
  const code = await rpc.getCode({ address: tx.contractAddress });
  manifest.contracts[name] = {
    address: tx.contractAddress,
    transaction: hash,
    block: tx.blockNumber.toString(),
    runtimeCodeHash: keccak256(code),
    constructorArgs: args.map((a) =>
      typeof a === 'bigint' ? a.toString() : typeof a === 'object' ? a : a,
    ),
  };
  save();
  return { address: tx.contractAddress, abi: source.abi };
}
async function write(label, contract, functionName, args) {
  if (manifest.steps[label]) return manifest.steps[label];
  const data = encodeFunctionData({ abi: contract.abi, functionName, args });
  const fees = await limits(data, contract.address);
  const { request } = await rpc.simulateContract({ ...contract, account, functionName, args, ...fees });
  const hash = await wallet.writeContract(request);
  await receipt(hash, label);
  manifest.steps[label] = hash;
  save();
  return hash;
}

async function main() {
  if ((await rpc.getChainId()) !== chain.id) throw new Error('Wrong chain: refusing deployment');
  const broadcast = process.argv.includes('--broadcast');
  console.log(
    'Plan: Morpho Blue + AdaptiveCurveIrm + testnet oracle, tUSDC/tETH 86% LLTV market seeded with 250k tUSDC;',
  );
  console.log('      OrbitLaunch on Arc USDC (20 USDC virtual reserve, 1% fee) with three seed launches.');
  if (!broadcast) return console.log('Run with --broadcast to send Arc testnet transactions.');
  account = await signer();
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase())
    throw new Error('Signer does not match manifest deployer');
  wallet = createWalletClient({ account, chain, transport: http() });
  console.log(`Deployer ${account.address}; gas cap ${formatUnits(maxBudget, 18)} USDC.`);

  const own = compile();
  const morphoArtifacts = await compileMorpho();
  const c = manifest.contracts;
  const tUSDC = { address: c.TestUSDC.address, abi: erc20Abi };
  const pairAbi = parseAbi([
    'function getReserves() view returns (uint112, uint112, uint32)',
    'function token0() view returns (address)',
  ]);

  // ---- Lending
  const morpho = await deploy('MorphoBlue', morphoArtifacts.Morpho, [account.address]);
  const irm = await deploy('AdaptiveCurveIrm', morphoArtifacts.AdaptiveCurveIrm, [morpho.address]);
  if (!manifest.contracts.OrbitTestnetOracle) {
    // Seed oracle from current pool spot. 1 tETH in tUSDC base units * 1e36 / 1e18.
    const [r0, r1] = await rpc.readContract({ address: manifest.pool.address, abi: pairAbi, functionName: 'getReserves' });
    const token0 = await rpc.readContract({ address: manifest.pool.address, abi: pairAbi, functionName: 'token0' });
    const [usdcReserve, ethReserve] =
      token0.toLowerCase() === c.TestUSDC.address.toLowerCase() ? [r0, r1] : [r1, r0];
    const price = (usdcReserve * 10n ** 36n) / ethReserve;
    console.log(`Oracle seed: 1 tETH = ${formatUnits((usdcReserve * 10n ** 18n) / ethReserve, 6)} tUSDC`);
    await deploy('OrbitTestnetOracle', own['contracts/src/OrbitTestnetOracle.sol'].OrbitTestnetOracle, [
      price,
      30n * 86400n,
      'tETH / tUSDC (testnet, owner-posted)',
    ]);
  }
  const oracle = { address: manifest.contracts.OrbitTestnetOracle.address };
  await write('Morpho enable AdaptiveCurveIrm', morpho, 'enableIrm', [irm.address]);
  await write('Morpho enable 86% LLTV', morpho, 'enableLltv', [LLTV]);
  const params = {
    loanToken: c.TestUSDC.address,
    collateralToken: c.TestETH.address,
    oracle: oracle.address,
    irm: irm.address,
    lltv: LLTV,
  };
  await write('Morpho create tUSDC/tETH market', morpho, 'createMarket', [params]);
  const seed = parseUnits('250000', 6);
  await write('Approve Morpho seed supply', tUSDC, 'approve', [morpho.address, seed]);
  await write('Seed Morpho tUSDC supply', morpho, 'supply', [params, seed, 0n, account.address, '0x']);
  const id = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
    ),
  );
  // Real utilization so the IRM produces live rates: 80 tETH collateral, 110k tUSDC debt (HF ≈ 1.68).
  const tETH = { address: c.TestETH.address, abi: erc20Abi };
  const collateral = parseUnits('80', 18);
  await write('Approve Morpho seed collateral', tETH, 'approve', [morpho.address, collateral]);
  await write('Seed Morpho tETH collateral', morpho, 'supplyCollateral', [params, collateral, account.address, '0x']);
  await write('Seed Morpho tUSDC borrow', morpho, 'borrow', [
    params,
    parseUnits('110000', 6),
    0n,
    account.address,
    account.address,
  ]);
  manifest.lending = {
    protocol: 'Morpho Blue (canonical source, project-deployed on testnet)',
    morpho: morpho.address,
    markets: [
      {
        id,
        label: 'tETH → tUSDC',
        ...params,
        lltv: LLTV.toString(),
      },
    ],
    note: 'Morpho has no official Arc testnet deployment; this instance is deployed by Orbit from vendored upstream source. Oracle is owner-posted and testnet-only.',
  };
  save();

  // ---- Launch curves on real Arc testnet USDC (ERC-20 interface of the native gas token).
  const launch = await deploy('OrbitLaunch', own['contracts/src/OrbitLaunch.sol'].OrbitLaunch, [
    USDC_ERC20,
    c.UniswapV2Router02.address,
    parseUnits('20', 6),
    100n,
    account.address,
  ]);
  const usdc = { address: USDC_ERC20, abi: erc20Abi };
  const seeds = [
    ['Arc Rocket', 'ROCKET', 'First launch on Orbit. Pure curve, no presale.'],
    ['Stable Frog', 'FROG', 'The calmest frog on the fastest stablechain.'],
    ['Sub Second', 'SUBSEC', 'Finality so fast the chart cannot keep up.'],
  ];
  const buy = parseUnits('0.5', 6);
  await write('Approve seed launch buys', usdc, 'approve', [launch.address, buy * BigInt(seeds.length)]);
  for (const [name, symbol, description] of seeds)
    await write(`Launch ${symbol}`, launch, 'launch', [name, symbol, '', description, buy, 0n]);
  manifest.launch = {
    contract: launch.address,
    quote: USDC_ERC20,
    quoteSymbol: 'USDC',
    virtualQuote: '20000000',
    feeBps: 100,
    graduation: 'Uniswap V2 pair via project factory, LP burned to 0xdEaD',
  };
  // ---- Hardened launch contract (two-step owner, launch-only pause, capped pages).
  // Testnet uses a 3 USDC virtual reserve so a full graduation can be rehearsed for ~8.6 USDC.
  const v3 = await deploy('OrbitLaunchV3', own['contracts/src/OrbitLaunch.sol'].OrbitLaunch, [
    USDC_ERC20,
    c.UniswapV2Router02.address,
    parseUnits('3', 6),
    100n,
    account.address,
  ]);
  const seedBuy = parseUnits('0.3', 6);
  await write('V3: approve seed buys', usdc, 'approve', [v3.address, seedBuy * 3n]);
  for (const [name, symbol, description] of seeds)
    await write(`V3: launch ${symbol}`, v3, 'launch', [name, symbol, '', description, seedBuy, 0n]);
  if (!manifest.legacyLaunch) manifest.legacyLaunch = { ...manifest.launch, note: 'superseded; see OrbitLaunchV3 (hardened, sell-out rounding fix)' };
  manifest.launch = {
    contract: v3.address,
    quote: USDC_ERC20,
    quoteSymbol: 'USDC',
    virtualQuote: '3000000',
    feeBps: 100,
    graduation: 'Uniswap V2 pair via project factory, LP burned to 0xdEaD',
  };
  manifest.capabilities = { ...manifest.capabilities, lending: true, launches: true };
  save();
  if (process.argv.includes('--rehearse')) {
  // Rehearsal: one curve bought out completely, which must graduate into a burned V2 pool.
    const [, charged] = await rpc.readContract({
      ...v3,
      functionName: 'quoteBuy',
      args: [await rpc.readContract({ ...v3, functionName: 'tokens', args: [0n] }), parseUnits('100', 6)],
    });
    await write('V3: approve graduation rehearsal', usdc, 'approve', [v3.address, charged]);
    const gradToken = await rpc.readContract({ ...v3, functionName: 'tokens', args: [0n] });
    await write('V3: graduation rehearsal buy', v3, 'buy', [
      gradToken,
      charged,
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 600),
    ]);
    manifest.launch.rehearsal = { token: gradToken, transaction: manifest.steps['V3: graduation rehearsal buy'] };
  }
  manifest.phase2CompletedAt = new Date().toISOString();
  save();
  console.log(`Done. Cumulative gas: ${formatUnits(BigInt(manifest.gasSpent), 18)} USDC.`);
}
main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
