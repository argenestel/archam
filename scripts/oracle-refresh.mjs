import fs from 'node:fs';
import { createWalletClient, formatUnits, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, rpc, loadDeployer } from './testnet-wallet.mjs';

// Re-posts the testnet oracle price from the tUSDC/tETH pool so the Morpho market never
// pauses on a stale price. Testnet only; a mainnet market must use an independent feed.
const m = JSON.parse(fs.readFileSync('deployments/arc-testnet.json', 'utf8'));
const pairAbi = parseAbi(['function getReserves() view returns (uint112, uint112, uint32)', 'function token0() view returns (address)']);
const oracleAbi = parseAbi(['function setPrice(uint256)', 'function latestPrice() view returns (uint256, uint256, bool)']);
const [r0, r1] = await rpc.readContract({ address: m.pool.address, abi: pairAbi, functionName: 'getReserves' });
const token0 = await rpc.readContract({ address: m.pool.address, abi: pairAbi, functionName: 'token0' });
const [usdc, eth] = token0.toLowerCase() === m.contracts.TestUSDC.address.toLowerCase() ? [r0, r1] : [r1, r0];
const price = (usdc * 10n ** 36n) / eth;
const oracle = m.contracts.OrbitTestnetOracle.address;
const [current, updatedAt] = await rpc.readContract({ address: oracle, abi: oracleAbi, functionName: 'latestPrice' });
console.log(`Pool: 1 tETH = ${formatUnits((usdc * 10n ** 18n) / eth, 6)} tUSDC; oracle updated ${new Date(Number(updatedAt) * 1000).toISOString()}`);
if (!process.argv.includes('--broadcast')) process.exit(0);
const line = fs.existsSync('.env') && fs.readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('ARC_TESTNET_DEPLOYER_PRIVATE_KEY='));
const raw = process.env.ARC_TESTNET_DEPLOYER_PRIVATE_KEY || (line && line.split('=')[1].trim());
const account = raw ? privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`) : privateKeyToAccount((await loadDeployer()).privateKey);
const wallet = createWalletClient({ account, chain, transport: http() });
const hash = await wallet.writeContract({ address: oracle, abi: oracleAbi, functionName: 'setPrice', args: [price] });
const receipt = await rpc.waitForTransactionReceipt({ hash });
console.log(`setPrice ${current} → ${price}: ${hash} (${receipt.status})`);
