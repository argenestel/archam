import { defineChain, isAddress, type Address } from "viem";

export const ARC_MAINNET_CHAIN_ID = 5042;

const rpcUrl = (process.env.NEXT_PUBLIC_ARC_MAINNET_RPC ?? "").trim();
const explorerUrl = (process.env.NEXT_PUBLIC_ARC_MAINNET_EXPLORER ?? "").trim();
const routerInput = (process.env.NEXT_PUBLIC_ARC_MAINNET_ROUTER ?? "").trim();
const factoryInput = (process.env.NEXT_PUBLIC_ARC_MAINNET_FACTORY ?? "").trim();
const usdcInput = (process.env.NEXT_PUBLIC_ARC_MAINNET_USDC ?? "").trim();
const eurcInput = (process.env.NEXT_PUBLIC_ARC_MAINNET_EURC ?? "").trim();

const addressOrUndefined = (value: string) =>
  isAddress(value) ? (value as Address) : undefined;

export const arcMainnet = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
  ...(explorerUrl
    ? { blockExplorers: { default: { name: "ArcScan", url: explorerUrl } } }
    : {}),
});

export const arcMainnetRouteConfig = {
  rpcUrl,
  explorerUrl,
  routerInput,
  factoryInput,
  usdcInput,
  eurcInput,
  routerAddress: addressOrUndefined(routerInput),
  factoryAddress: addressOrUndefined(factoryInput),
  usdcAddress: addressOrUndefined(usdcInput),
  eurcAddress: addressOrUndefined(eurcInput),
} as const;

export const arcMainnetRouteConfigured = Boolean(
  rpcUrl &&
    arcMainnetRouteConfig.routerAddress &&
    arcMainnetRouteConfig.factoryAddress &&
    arcMainnetRouteConfig.usdcAddress &&
    arcMainnetRouteConfig.eurcAddress
);
