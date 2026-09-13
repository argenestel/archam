"use client";

import { useSyncExternalStore } from "react";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { arcTestnet } from "viem/chains";
import { curveLaunchpad } from "./generated/curveLaunchpad";
import { curveToken } from "./generated/curveToken";

export const arcClient = createPublicClient({ chain: arcTestnet, transport: http() });
export const unit = 10n ** 18n;
export const bookConfigured = process.env.NEXT_PUBLIC_ORDERBOOK_ADDRESS ?? "";
const factoryConfigured = process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS ?? "";
const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn); window.addEventListener("mofu-market", fn);
  return () => { window.removeEventListener("storage", fn); window.removeEventListener("mofu-market", fn); };
};
function read(key: string, configured: string) { try { return configured || localStorage.getItem(key) || ""; } catch { return configured; } }
export function useMarketAddresses() {
  const factory = useSyncExternalStore(subscribe, () => read("mofu-curve-market-v1", factoryConfigured), () => factoryConfigured);
  const book = useSyncExternalStore(subscribe, () => read("mofu-orderbook-v1", bookConfigured), () => bookConfigured);
  return { factory, book };
}
export function saveBook(address: Address) { localStorage.setItem("mofu-orderbook-v1", address); window.dispatchEvent(new Event("mofu-market")); }
export { money } from "./market-safety";
export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export type MarketToken = { index: bigint; address: Address; name: string; symbol: string; image?: string };
export async function readTokens(factory: string, page = 0, size = 20) {
  if (!isAddress(factory)) throw new Error("Choose a launch market first.");
  const count = await arcClient.readContract({ address: factory, abi: curveLaunchpad.abi, functionName: "tokenCount" });
  const end = count - BigInt(page * size);
  const length = Number(end > BigInt(size) ? BigInt(size) : end > 0n ? end : 0n);
  const tokens = await Promise.all(Array.from({ length }, async (_, i): Promise<MarketToken> => {
    const index = end - 1n - BigInt(i);
    const address = await arcClient.readContract({ address: factory, abi: curveLaunchpad.abi, functionName: "tokens", args: [index] });
    const [name, symbol, image] = await arcClient.multicall({ allowFailure: false, contracts: [
      { address, abi: curveToken.abi, functionName: "name" },
      { address, abi: curveToken.abi, functionName: "symbol" },
      { address, abi: curveToken.abi, functionName: "icon" },
    ] });
    return { index, address, name, symbol, image };
  }));
  return { count, tokens };
}
