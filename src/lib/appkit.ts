import { isAddress, keccak256, parseAbi, type EIP1193Provider } from 'viem';
import { client } from './arc';
import mainnet from '../../deployments/arc-mainnet.json';
import { isTestnet } from './arc';
import { useQuery } from './query';

// Circle App Kit (docs.arc.io/app-kit): official Swap (USDC/EURC/cirBTC) and Earn (Morpho
// vault) integrations on Arc mainnet and testnet. Loaded lazily; no API key in the browser.
export const kitChain: 'Arc' | 'Arc_Testnet' = isTestnet ? 'Arc_Testnet' : 'Arc';
/** Mainnet writes stay off until a build sets VITE_MAINNET_SIGNING=1 (Phase 1 gate). */
export const signingEnabled = isTestnet || import.meta.env.VITE_MAINNET_SIGNING === '1';

let kitPromise: Promise<import('@circle-fin/app-kit').AppKit> | undefined;
export const getKit = () =>
  (kitPromise ??= import('@circle-fin/app-kit').then(({ AppKit }) => new AppKit()));
export async function adapterFor(provider: EIP1193Provider) {
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2');
  return createViemAdapterFromProvider({ provider: provider as never });
}

export type Vault = {
  address: `0x${string}`;
  name: string;
  protocol: string;
  asset: 'USDC' | 'EURC' | string;
  apy: number;
  tvl: number;
  liquidity: number;
  warnings: string[];
  status: string;
  asOf: string;
};

/**
 * Vault curation. App Kit discovery returns every vault, including tests and empty ones,
 * so only named, active vaults without risk warnings, with positive APY and (on mainnet)
 * at least $250k deposited are shown.
 */
export function catalogVaults(raw: Record<string, unknown>[]): Vault[] {
  return raw
    .map((v) => ({
      address: v.vaultAddress as `0x${string}`,
      name: String(v.name || '').trim(),
      protocol: String(v.protocol || ''),
      asset: String(v.asset || ''),
      apy: Number(v.currentApy) || 0,
      tvl: Number(v.totalDeposits) || 0,
      liquidity: Number(v.liquidity) || 0,
      status: String(v.status || 'unknown'),
      asOf: String(v.asOf || ''),
      warnings: [
        ...((v.riskSignals as { warnings?: unknown[] })?.warnings ?? []),
        ...((v.riskSignals as { earnKitWarnings?: unknown[] })?.earnKitWarnings ?? []),
      ].map((w) =>
        typeof w === 'string' ? w : String((w as { type?: string })?.type || 'Provider warning'),
      ),
    }))
    .filter((v) => isAddress(v.address) && ['USDC', 'EURC'].includes(v.asset))
    .sort((a, b) => b.apy - a.apy);
}
export function curate(raw: Record<string, unknown>[]): Vault[] {
  return catalogVaults(raw)
    .filter((v) => v.status === 'active' && v.name.length > 2 && v.apy > 0 && !v.warnings.length)
    .filter((v) => isTestnet || (v.tvl >= 250_000 && !/\btest\b/i.test(v.name)));
}
export function useVaultCatalog() {
  return useQuery(
    `appkit:catalog:${kitChain}`,
    async () => {
      const { vaults } = await (
        await getKit()
      ).earn.exploreVaults({ chain: kitChain, sortBy: 'apy' });
      return catalogVaults(vaults as unknown as Record<string, unknown>[]);
    },
    60_000,
  );
}
export async function verifyVault(vault: Vault, asset: `0x${string}`) {
  const [code, actualAsset] = await Promise.all([
    client.getCode({ address: vault.address }),
    client.readContract({
      address: vault.address,
      abi: parseAbi(['function asset() view returns (address)']),
      functionName: 'asset',
    }),
  ]);
  if (!code || code === '0x' || actualAsset.toLowerCase() !== asset.toLowerCase())
    throw new Error('Vault code or deposit asset verification failed');
  const known = mainnet.earnVaults.find(
    (v) => v.address.toLowerCase() === vault.address.toLowerCase(),
  );
  if (!isTestnet && known && keccak256(code) !== known.runtimeCodeHash)
    throw new Error('Vault bytecode changed since the recorded verification');
}

export function useVaults() {
  return useQuery(
    `appkit:vaults:${kitChain}`,
    async () => {
      const kit = await getKit();
      const { vaults } = await kit.earn.exploreVaults({ chain: kitChain as never, sortBy: 'apy' });
      return curate(vaults as unknown as Record<string, unknown>[]);
    },
    60_000,
  );
}

export function useTokenRates() {
  return useQuery(
    `appkit:rates:${kitChain}`,
    async () => {
      const kit = await getKit();
      const { rates } = await kit.getTokenRates({ chain: kitChain as never });
      return Object.fromEntries(
        Object.entries(
          (rates as Record<string, Record<string, { priceUSD: string }>>)[kitChain] ?? {},
        ).map(([a, r]) => [a.toLowerCase(), Number(r.priceUSD)]),
      );
    },
    60_000,
  );
}
