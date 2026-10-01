import { isAddress, keccak256, parseAbi, type Address } from 'viem';
import manifest from '../../deployments/arc-testnet.json';
import { arcTestnet, client } from './arc';
export const deployment = manifest;
export const deployedTokens = [
  {
    symbol: 'tUSDC',
    decimals: 6,
    address: manifest.contracts.TestUSDC.address as Address,
    color: '#2775ca',
  },
  {
    symbol: 'tETH',
    decimals: 18,
    address: manifest.contracts.TestETH.address as Address,
    color: '#7785bd',
  },
];
export const deployedRouter = manifest.contracts.UniswapV2Router02.address as Address;
export const deployedLaunchpad = manifest.contracts.FixedPriceLaunchpad.address as Address;
export const faucetAbi = parseAbi([
  'function faucet()',
  'function claimed(address) view returns (bool)',
]);
export const launchpadAbi = parseAbi([
  'function contribute(uint256 amount)',
  'function claim()',
  'function refund()',
  'function totalRaised() view returns (uint256)',
  'function softCap() view returns (uint256)',
  'function hardCap() view returns (uint256)',
  'function start() view returns (uint256)',
  'function end() view returns (uint256)',
  'function cancelled() view returns (bool)',
  'function successful() view returns (bool)',
  'function contributions(address) view returns (uint256)',
  'function allocations(address) view returns (uint256)',
]);
export async function verifyStack() {
  if (manifest.chainId !== arcTestnet.id || (await client.getChainId()) !== arcTestnet.id)
    throw new Error('Deployment chain mismatch');
  await Promise.all(
    ['TestUSDC', 'TestETH', 'UniswapV2Factory', 'UniswapV2Router02', 'FixedPriceLaunchpad'].map(
      async (name) => {
        const entry = manifest.contracts[name as keyof typeof manifest.contracts];
        if (!isAddress(entry.address)) throw new Error(`Invalid ${name} address`);
        const code = await client.getCode({ address: entry.address });
        if (!code || keccak256(code) !== entry.runtimeCodeHash)
          throw new Error(`${name} bytecode differs from deployment manifest`);
      },
    ),
  );
}
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value) || (value.split('.')[1]?.length || 0) > decimals)
    throw new Error(`Enter a positive amount with at most ${decimals} decimals`);
  const [whole = '0', fraction = ''] = value.split('.');
  const amount =
    BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('Amount out of range');
  return amount;
}
