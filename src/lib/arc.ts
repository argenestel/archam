import { createPublicClient, defineChain, fallback, http, isAddress, type Address } from 'viem';

// Arc official connection reference: https://docs.arc.io/arc/references/connect-to-arc
// Native USDC has 18 decimals; its ERC-20 interface at 0x3600… uses 6. Never mix them.
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.testnet.arc.io',
        'https://rpc.quicknode.testnet.arc.io',
        'https://rpc.drpc.testnet.arc.io',
      ],
    },
  },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  testnet: true,
});
export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.mainnet.arc.io',
        'https://rpc.quicknode.mainnet.arc.io',
        'https://rpc.drpc.mainnet.arc.io',
      ],
    },
  },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

/** Build-time network. Mainnet builds only enable features with a mainnet deployment record. */
export const networkName: 'testnet' | 'mainnet' =
  import.meta.env.VITE_ARC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
export const activeChain = networkName === 'mainnet' ? arcMainnet : arcTestnet;
export const isTestnet = networkName === 'testnet';

// Browser reads stay on this origin; Vite/Nginx forwards to official documented endpoints.
// Wallet network metadata remains the public RPC URL, never a proxy URL.
const suffix = networkName === 'mainnet' ? '-mainnet' : '';
const rpcRoutes = [`/api/arc-rpc${suffix}`, `/api/arc-rpc${suffix}-quicknode`, `/api/arc-rpc${suffix}-drpc`];
const rpcUrls =
  typeof window === 'undefined'
    ? [...activeChain.rpcUrls.default.http]
    : rpcRoutes.map((route) => new URL(route, window.location.origin).href);
export const client = createPublicClient({
  chain: activeChain,
  batch: { multicall: { wait: 16 } },
  transport: fallback(
    rpcUrls.map((url) => http(url, { timeout: 6000, retryCount: 1, batch: { wait: 8 } })),
    { retryCount: 0 },
  ),
});
export const explorer = activeChain.blockExplorers.default.url;
export const txUrl = (hash: string) => `${explorer}/tx/${hash}`;
export const addressUrl = (address: string) => `${explorer}/address/${address}`;

/** Circle-issued assets (docs.arc.io/arc/references/contract-addresses). */
export const circle = {
  usdc: '0x3600000000000000000000000000000000000000' as Address,
  eurc: (networkName === 'mainnet'
    ? '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
    : '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a') as Address,
};

export async function verifyDeployment(address: string | undefined): Promise<Address> {
  if (!address || !isAddress(address)) throw new Error('No verified Arc deployment configured.');
  const code = await client.getCode({ address });
  if (!code || code === '0x') throw new Error('No contract deployed at the configured address.');
  return address;
}
