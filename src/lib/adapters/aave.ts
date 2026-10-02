import { erc20Abi, parseAbi, type Address } from 'viem';
import { client } from '../arc';
import type { Token } from '../contracts';
import { useQuery } from '../query';

/**
 * Aave V4 on Arc mainnet. Addresses from Aave's generated address book
 * (bgd-labs/aave-address-book `src/ts/AaveV4Arc.ts`, commit f648e5dd, 2026-10-02) and checked
 * on-chain: the Core Hub, Main/Forex spokes, and the per-asset tokenization spokes, which are
 * ERC-4626 vaults ("Wrapped Aave Core USDC", waCoreUSDC…) over the Core Hub.
 */
export const AAVE_V4 = {
  coreHub: '0x17288dfc86205301064577b98B02b81017e6F79C',
  mainSpoke: '0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d',
  forexSpoke: '0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB',
  vaults: [
    { symbol: 'USDC', vault: '0x42EAB64310E1D1c66b4d8aF7C9C4ce253885eB83', underlying: '0x3600000000000000000000000000000000000000', decimals: 6 },
    { symbol: 'EURC', vault: '0x5A10b1533C0f1f181DC8a428BF5Eb58B08fc8d2c', underlying: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
    { symbol: 'cirBTC', vault: '0x83D364DbAf4e7018E0b87dB3FaB3d1d8535a6F13', underlying: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
    { symbol: 'WETH', vault: '0xe8B890fea6e1E3915A337eD3136487F2f4f7e59D', underlying: '0x128cC466B61f542da60c70e3aA11c10e19B84EDB', decimals: 18 },
  ],
} as const;

export const erc4626Abi = parseAbi([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
]);

export type AaveVault = {
  symbol: string;
  vault: Address;
  token: Token;
  tvl: bigint;
  /** Realized APY from the share price over ~24h (compounded daily); undefined if unavailable. */
  apy?: number;
  maxDeposit: bigint;
  shares: bigint;
  assets: bigint;
  maxWithdraw: bigint;
};

const ONE_SHARE = 10n ** 18n; // probe size; any large amount works for a price ratio
/** Arc blocks are ~0.5s; 170k blocks ≈ 24h. The actual elapsed time is read from the blocks. */
const LOOKBACK = 170_000n;

export async function loadAaveVaults(account?: Address): Promise<AaveVault[]> {
  const head = await client.getBlock();
  const pastNumber = head.number > LOOKBACK ? head.number - LOOKBACK : 1n;
  const past = await client.getBlock({ blockNumber: pastNumber });
  const years = (Number(head.timestamp) - Number(past.timestamp)) / 31_536_000;
  return Promise.all(
    AAVE_V4.vaults.map(async (v) => {
      // Integrity: the vault's underlying must be the asset the address book claims.
      const asset = await client.readContract({ address: v.vault, abi: erc4626Abi, functionName: 'asset' });
      if (asset.toLowerCase() !== v.underlying.toLowerCase()) throw new Error(`Aave ${v.symbol} vault asset mismatch`);
      const [tvl, now, then, maxDeposit, shares, maxWithdraw] = await Promise.all([
        client.readContract({ address: v.vault, abi: erc4626Abi, functionName: 'totalAssets' }),
        client.readContract({ address: v.vault, abi: erc4626Abi, functionName: 'convertToAssets', args: [ONE_SHARE] }),
        client
          .readContract({ address: v.vault, abi: erc4626Abi, functionName: 'convertToAssets', args: [ONE_SHARE], blockNumber: pastNumber })
          .catch(() => undefined),
        client.readContract({ address: v.vault, abi: erc4626Abi, functionName: 'maxDeposit', args: [account ?? v.vault] }),
        account ? client.readContract({ address: v.vault, abi: erc4626Abi, functionName: 'balanceOf', args: [account] }) : 0n,
        account ? client.readContract({ address: v.vault, abi: erc4626Abi, functionName: 'maxWithdraw', args: [account] }) : 0n,
      ]);
      const growth = then && then > 0n ? Number(now) / Number(then) - 1 : undefined;
      const apy = growth !== undefined && years > 0 ? Math.pow(1 + growth, 1 / years) - 1 : undefined;
      return {
        symbol: v.symbol,
        vault: v.vault,
        token: { symbol: v.symbol, name: v.symbol, address: v.underlying, decimals: v.decimals, kind: 'circle' } satisfies Token,
        tvl,
        apy,
        maxDeposit,
        shares,
        assets: (shares * now) / ONE_SHARE,
        maxWithdraw,
      };
    }),
  );
}

export function useAaveVaults(account?: Address, enabled = true) {
  return useQuery(enabled ? `aave:vaults:${account ?? ''}` : null, () => loadAaveVaults(account), 30_000);
}

/** ERC-4626 deposit (exact approval to the vault) and withdraw/redeem requests. */
export const aaveRequests = {
  deposit: (vault: Address, assets: bigint, receiver: Address) => ({
    address: vault,
    abi: erc4626Abi,
    functionName: 'deposit',
    args: [assets, receiver],
  }),
  withdraw: (vault: Address, assets: bigint, owner: Address) => ({
    address: vault,
    abi: erc4626Abi,
    functionName: 'withdraw',
    args: [assets, owner, owner],
  }),
  /** Full exit by shares, so accrued interest between quote and confirmation is not left behind. */
  redeemAll: (vault: Address, shares: bigint, owner: Address) => ({
    address: vault,
    abi: erc4626Abi,
    functionName: 'redeem',
    args: [shares, owner, owner],
  }),
};

export { erc20Abi };
