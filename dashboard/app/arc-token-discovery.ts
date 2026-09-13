import { isAddress, type Address } from "viem";

const API = "https://api-testnet.arc-scan.org/v1";

type ArcScanToken = {
  address: string;
  checksum?: string;
  name: string;
  symbol: string;
  decimals: number | null;
  standard: string;
};

type ArcScanItem = { token?: ArcScanToken };

export type DiscoveredArcToken = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  image: string;
};

function tokenFromItem(item: ArcScanItem): DiscoveredArcToken | undefined {
  const token = item.token;
  if (!token || token.standard.toLowerCase() !== "erc20" || token.decimals == null || !isAddress(token.address)) return undefined;
  return {
    address: token.checksum && isAddress(token.checksum) ? token.checksum : token.address,
    name: token.name || "Unnamed token",
    symbol: token.symbol || "TOKEN",
    decimals: token.decimals,
    image: `${API}/tokens/${token.address}/logo`,
  };
}

export async function discoverArcTokens(limit = 50): Promise<DiscoveredArcToken[]> {
  const response = await fetch(`${API}/explore/tokens?limit=${Math.min(Math.max(limit, 1), 100)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Arc token discovery unavailable (${response.status}).`);
  const body = await response.json() as { items?: ArcScanItem[] };
  return (body.items ?? []).map(tokenFromItem).filter((token): token is DiscoveredArcToken => !!token);
}
