import fs from 'node:fs';
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, rpc, loadDeployer } from './testnet-wallet.mjs';
const file = 'deployments/arc-testnet.json';
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const routerAbi = parseAbi([
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
]);
const saleAbi = parseAbi([
  'function start() view returns (uint256)',
  'function contribute(uint256)',
  'function allocations(address) view returns (uint256)',
]);
let spent = 0n;
async function main() {
  if ((await rpc.getChainId()) !== chain.id) throw new Error('Wrong chain');
  for (const [name, contract] of Object.entries(manifest.contracts)) {
    const code = await rpc.getCode({ address: contract.address });
    if (!code || keccak256(code) !== contract.runtimeCodeHash)
      throw new Error(`Code mismatch: ${name}`);
  }
  const router = manifest.contracts.UniswapV2Router02.address,
    usdc = manifest.contracts.TestUSDC.address,
    eth = manifest.contracts.TestETH.address,
    pad = manifest.contracts.FixedPriceLaunchpad.address;
  const amounts = await rpc.readContract({
    address: router,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [parseUnits('1', 6), [usdc, eth]],
  });
  console.log(
    `Verified runtime hashes. Onchain quote: 1 tUSDC -> ${formatUnits(amounts[1], 18)} tETH.`,
  );
  if (!process.argv.includes('--broadcast')) {
    console.log(
      'Read-only check passed. Use --broadcast for a 1 tUSDC swap and 10 tUSDC sale contribution (max 0.2 native USDC gas).',
    );
    return;
  }
  if (manifest.smoke?.completedAt) {
    console.log('Smoke transactions already completed. Refusing duplicate broadcast.');
    return;
  }
  const signer = await loadDeployer(),
    account = privateKeyToAccount(signer.privateKey);
  const wallet = createWalletClient({ chain, account, transport: http() });
  const results = [];
  async function send(label, address, abi, functionName, args) {
    const data = encodeFunctionData({ abi, functionName, args });
    const gasPrice = await rpc.getGasPrice();
    const gas =
      ((await rpc.estimateGas({ account: account.address, to: address, data })) * 125n) / 100n;
    if (spent + gas * gasPrice > parseUnits('0.2', 18))
      throw new Error('Smoke gas budget exceeded');
    const { request } = await rpc.simulateContract({
      address,
      abi,
      functionName,
      args,
      account,
      gas,
      gasPrice,
    });
    const hash = await wallet.writeContract({ ...request, chain });
    const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 120000 });
    spent += receipt.gasUsed * receipt.effectiveGasPrice;
    if (receipt.status !== 'success') throw new Error(`${label} reverted`);
    results.push({
      label,
      hash,
      gasCost: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    });
    console.log(`${label}: ${hash}`);
  }
  const before = await rpc.readContract({
    address: eth,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  await send('Approve 1 tUSDC for swap', usdc, erc20Abi, 'approve', [router, parseUnits('1', 6)]);
  const current = await rpc.readContract({
    address: router,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [parseUnits('1', 6), [usdc, eth]],
  });
  const block = await rpc.getBlock();
  await send('Swap 1 tUSDC', router, routerAbi, 'swapExactTokensForTokens', [
    parseUnits('1', 6),
    (current[1] * 995n) / 1000n,
    [usdc, eth],
    account.address,
    block.timestamp + 300n,
  ]);
  const after = await rpc.readContract({
    address: eth,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (after <= before) throw new Error('Swap output not received');
  const saleStart = await rpc.readContract({ address: pad, abi: saleAbi, functionName: 'start' });
  if ((await rpc.getBlock()).timestamp < saleStart)
    throw new Error('Sale not open yet; swap succeeded. Retry sale smoke after start.');
  await send('Approve 10 tUSDC sale payment', usdc, erc20Abi, 'approve', [
    pad,
    parseUnits('10', 6),
  ]);
  await send('Contribute 10 tUSDC', pad, saleAbi, 'contribute', [parseUnits('10', 6)]);
  const allocation = await rpc.readContract({
    address: pad,
    abi: saleAbi,
    functionName: 'allocations',
    args: [account.address],
  });
  if (allocation < parseUnits('20', 18)) throw new Error('Sale allocation incorrect');
  manifest.smoke = {
    completedAt: new Date().toISOString(),
    transactions: results,
    swapReceivedETH: (after - before).toString(),
    saleAllocation: allocation.toString(),
    gasSpent: spent.toString(),
  };
  manifest.liveExecutionEnabled = true;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync('public/arc-testnet-deployment.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Onchain smoke passed. Gas: ${formatUnits(spent, 18)} native testnet USDC.`);
}
main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
