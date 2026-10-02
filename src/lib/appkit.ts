import type { EIP1193Provider } from 'viem';
import { isTestnet } from './arc';
import { useQuery } from './query';

// Circle App Kit (docs.arc.io/app-kit): official Swap (USDC/EURC/cirBTC) and Earn (Morpho
// vault) integrations on Arc mainnet and testnet. Loaded lazily; no API key in the browser.
export const kitChain = isTestnet ? 'Arc_Testnet' : 'Arc';
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
};

/**
 * Vault curation. App Kit discovery returns every vault, including tests and empty ones,
 * so only named, active vaults without risk warnings, with positive APY and (on mainnet)
 * at least $250k deposited are shown.
 */
export function curate(raw: Record<string, unknown>[]): Vault[] {
  return raw
    .map((v) => ({
      address: v.vaultAddress as `0x${string}`,
      name: String(v.name || '').trim(),
      protocol: String(v.protocol || ''),
      asset: String(v.asset || ''),
      apy: Number(v.currentApy) || 0,
      tvl: Number(v.totalDeposits) || 0,
      liquidity: Number(v.liquidity) || 0,
      status: v.status,
      warnings: [
        ...(((v.riskSignals as { warnings?: string[] })?.warnings) ?? []),
        ...(((v.riskSignals as { earnKitWarnings?: string[] })?.earnKitWarnings) ?? []),
      ],
    }))
    .filter((v) => v.status === 'active' && v.name.length > 2 && v.apy > 0 && !v.warnings.length)
    .filter((v) => isTestnet || (v.tvl >= 250_000 && !/\btest\b/i.test(v.name)))
    .sort((a, b) => b.apy - a.apy)
    .map(({ status: _status, ...v }) => v);
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
        Object.entries((rates as Record<string, Record<string, { priceUSD: string }>>)[kitChain] ?? {}).map(
          ([a, r]) => [a.toLowerCase(), Number(r.priceUSD)],
        ),
      );
    },
    60_000,
  );
}
