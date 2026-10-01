import { createPublicClient, defineChain, http, isAddress, type Address } from 'viem';

// Arc official connection reference: https://docs.arc.io/arc/references/connect-to-arc
// Native USDC has 18 decimals; ERC-20 USDC is a distinct interface (usually 6).
export const arcTestnet = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } }, blockExplorers: { default: { name: 'Arc Explorer', url: 'https://testnet.arcscan.app' } }, testnet: true });
export const client = createPublicClient({ chain: arcTestnet, transport: http() });
export const integrations = {
  router: import.meta.env.VITE_ARC_ROUTER_ADDRESS as string | undefined,
  lendingPool: import.meta.env.VITE_ARC_AAVE_POOL_ADDRESS as string | undefined,
  launchpad: import.meta.env.VITE_ARC_LAUNCHPAD_ADDRESS as string | undefined,
};
export async function verifyDeployment(address: string | undefined): Promise<Address> {
  if (!address || !isAddress(address)) throw new Error('No verified Arc deployment configured. Use demo mode.');
  const code = await client.getCode({ address });
  if (!code || code === '0x') throw new Error('No contract deployed at the configured address on Arc testnet.');
  return address;
}
