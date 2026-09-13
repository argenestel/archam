import { createPublicClient, erc20Abi, getAddress, http, isAddress, type Address } from "viem";
import { arcTestnet } from "viem/chains";

export const ARC_SCAN_API = "https://api-testnet.arc-scan.org/v1";
export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
export const ARC_EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const arcClient = createPublicClient({ chain: arcTestnet, transport: http() });

type ArcScanToken = {
  address?: unknown;
  checksum?: string;
  name?: unknown;
  symbol?: unknown;
  decimals?: unknown;
  standard?: unknown;
};

type ArcScanItem = { token?: ArcScanToken };

export type DiscoveredArcToken = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  image: string;
  source: "curated" | "arcscan" | "imported";
};

export const curatedArcTokens: DiscoveredArcToken[] = [
  {
    address: ARC_USDC,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    image: "/token-images/usdc.svg",
    source: "curated",
  },
  {
    address: ARC_EURC,
    name: "Euro Coin",
    symbol: "EURC",
    decimals: 6,
    image: "/token-images/eurc.svg",
    source: "curated",
  },
];

function checksum(address: string): Address | undefined {
  if (!isAddress(address)) return undefined;
  try {
    return getAddress(address);
  } catch {
    return undefined;
  }
}

function validText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeArcToken(item: unknown): DiscoveredArcToken | undefined {
  if (!item || typeof item !== "object" || !("token" in item)) return undefined;
  const token = (item as ArcScanItem).token;
  if (!token || typeof token !== "object" || typeof token.standard !== "string" || token.standard.toLowerCase() !== "erc20") return undefined;
  const address = checksum(typeof token.address === "string" ? token.address : "");
  const decimals = token.decimals;
  if (!address || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;
  return {
    address,
    name: validText(token.name, "Unnamed token"),
    symbol: validText(token.symbol, "TOKEN"),
    decimals,
    // ArcScan's logo endpoint sends a cross-origin resource policy that many
    // wallets block. Keep detection reliable with the local neutral fallback.
    image: "/token-images/default.svg",
    source: "arcscan",
  };
}

export function mergeArcTokens(tokens: DiscoveredArcToken[]) {
  const merged = new Map<string, DiscoveredArcToken>();
  for (const token of [...curatedArcTokens, ...tokens]) {
    const key = token.address.toLowerCase();
    if (!merged.has(key)) merged.set(key, token);
  }
  return [...merged.values()];
}

export async function discoverArcTokens(limit = 50): Promise<DiscoveredArcToken[]> {
  const pageSize = Math.min(Math.max(limit, 1), 100);
  const discovered: DiscoveredArcToken[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3 && discovered.length < pageSize; page += 1) {
    const url = new URL(`${ARC_SCAN_API}/explore/tokens`);
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Arc token discovery unavailable (${response.status}).`);
    const body = await response.json() as { items?: unknown[]; page?: { next?: string | null } };
    const items = Array.isArray(body.items) ? body.items : [];
    discovered.push(...items
      .map(normalizeArcToken)
      .filter((token): token is DiscoveredArcToken => !!token));
    cursor = body.page?.next ?? undefined;
    if (!cursor) break;
  }
  return mergeArcTokens(discovered).slice(0, pageSize);
}

/** Validate an address pasted into the picker against the live Arc Testnet RPC. */
export async function readArcToken(address: string): Promise<DiscoveredArcToken> {
  const tokenAddress = checksum(address.trim());
  if (!tokenAddress) throw new Error("Enter a valid ERC-20 contract address.");
  if ((await arcClient.getCode({ address: tokenAddress })) === "0x") {
    throw new Error("That address has no contract code on Arc Testnet.");
  }

  const [name, symbol, decimals] = await Promise.all([
    arcClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" }),
    arcClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
    arcClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (decimals > 36) throw new Error("This token reports unsupported precision.");
  return {
    address: tokenAddress,
    name: validText(name, "Unnamed token"),
    symbol: validText(symbol, "TOKEN"),
    decimals,
    image: "/token-images/default.svg",
    source: "imported",
  };
}
