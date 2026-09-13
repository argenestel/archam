"use client";

import { useSyncExternalStore } from "react";
import { erc20Abi, isAddress, zeroAddress, type Address } from "viem";
import { arcClient } from "./market-data";
import { mofuFactoryV2 } from "./generated/mofuFactoryV2";
import { mofuTokenV2 } from "./generated/mofuTokenV2";
import { mofuPool } from "./generated/mofuPool";

export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
const configured = process.env.NEXT_PUBLIC_MOFU_V2_FACTORY ?? "";
const key = "mofu-v2-factory";
const subscribe = (fn: () => void) => {
 window.addEventListener("mofu-v2", fn); window.addEventListener("storage", fn);
 return () => { window.removeEventListener("mofu-v2", fn); window.removeEventListener("storage", fn); };
};
const snapshot = () => { try { return configured || localStorage.getItem(key) || ""; } catch { return configured; } };
export function useV2Factory() { return useSyncExternalStore(subscribe, snapshot, () => configured); }
export function saveV2Factory(value: Address) { localStorage.setItem(key, value); window.dispatchEvent(new Event("mofu-v2")); }

export async function readV2Token(address: Address) {
 const base = { address, abi: mofuTokenV2.abi } as const;
 const [name, symbol, image, sold, cap, pool, quote, decimals] = await Promise.all([
  arcClient.readContract({ ...base, functionName:"name" }),
  arcClient.readContract({ ...base, functionName:"symbol" }),
  arcClient.readContract({ ...base, functionName:"imageURI" }),
  arcClient.readContract({ ...base, functionName:"soldWhole" }),
  arcClient.readContract({ ...base, functionName:"curveSupplyWhole" }),
  arcClient.readContract({ ...base, functionName:"pool" }),
  arcClient.readContract({ ...base, functionName:"quote" }),
  arcClient.readContract({ ...base, functionName:"quoteDecimals" }),
 ]);
 const quoteSymbol = await arcClient.readContract({ address:quote, abi:erc20Abi, functionName:"symbol" });
 return { address, name, symbol, image, sold, cap, pool, quote, decimals, quoteSymbol, graduated:pool !== zeroAddress };
}
export type V2Token = Awaited<ReturnType<typeof readV2Token>>;
export async function readV2Market(factory: string, page = 0) {
 if (!isAddress(factory)) throw new Error("Configure a graduating-token market.");
 const count = await arcClient.readContract({ address:factory, abi:mofuFactoryV2.abi, functionName:"tokenCount" });
 const end = count - BigInt(page * 12);
 const length = Number(end > 12n ? 12n : end > 0n ? end : 0n);
 const tokens = await Promise.all(Array.from({length}, async (_, i) => {
  const address = await arcClient.readContract({address:factory, abi:mofuFactoryV2.abi, functionName:"tokens", args:[end - 1n - BigInt(i)]});
  return readV2Token(address);
 }));
 return { count, tokens };
}
export async function quoteV2(token: V2Token, side: "buy" | "sell", amount: bigint) {
 if (amount <= 0n) throw new Error("Enter a positive amount.");
 if (!token.graduated) {
  if (side === "buy") return arcClient.readContract({ address:token.address, abi:mofuTokenV2.abi, functionName:"buyCost", args:[amount] });
  const gross = await arcClient.readContract({ address:token.address, abi:mofuTokenV2.abi, functionName:"quoteSell", args:[amount] });
  return gross - gross / 100n;
 }
 const [x,y] = await arcClient.readContract({ address:token.pool, abi:mofuPool.abi, functionName:"reserves" });
 if (!x || !y) throw new Error("Pool has no liquidity.");
 const fee = await arcClient.readContract({address:token.pool, abi:mofuPool.abi, functionName:"feeBps"});
 if (side === "buy") { const net = amount - amount * fee / 10000n; return y - x * y / (x + net); }
 const gross = x - x * y / (y + amount);
 return gross - gross * fee / 10000n;
}
