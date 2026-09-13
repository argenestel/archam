// Read-only Arc Mainnet router readiness check. It never signs or submits a transaction.
import { createPublicClient, defineChain, http, isAddress } from "viem";

const rpc = (process.env.NEXT_PUBLIC_ARC_MAINNET_RPC || "").trim();
const router = (process.env.NEXT_PUBLIC_ARC_MAINNET_ROUTER || "").trim();
const factory = (process.env.NEXT_PUBLIC_ARC_MAINNET_FACTORY || "").trim();
const usdc = (process.env.NEXT_PUBLIC_ARC_MAINNET_USDC || "").trim();
const eurc = (process.env.NEXT_PUBLIC_ARC_MAINNET_EURC || "").trim();
const chainId = 5042;

if (!rpc || !router || !factory || !usdc || !eurc) {
  console.log(JSON.stringify({
    network: "Arc Mainnet",
    chainId,
    router: router || null,
    factory: factory || null,
    usdc: usdc || null,
    eurc: eurc || null,
    result: "PENDING_CONFIGURATION",
    reason: "Set the explicit Arc Mainnet RPC, router, factory, USDC, and EURC values before enabling the route.",
  }));
  process.exit(0);
}

if (![router, factory, usdc, eurc].every(isAddress)) {
  console.log(JSON.stringify({ network: "Arc Mainnet", chainId, router, factory, usdc, eurc, result: "INVALID_ROUTE_ADDRESS" }));
  process.exit(1);
}

const chain = defineChain({
  id: chainId,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const actualChainId = await client.getChainId();
const routerAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: [{ name: "amounts", type: "uint256[]" }] },
];
const factoryAbi = [{ type: "function", name: "getPair", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }] }];
const [routerCode, factoryCode, boundFactory, pair] = await Promise.all([
  client.getCode({ address: router }),
  client.getCode({ address: factory }),
  client.readContract({ address: router, abi: routerAbi, functionName: "factory" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "getPair", args: [usdc, eurc] }),
]);
if (actualChainId !== chainId) {
  console.log(JSON.stringify({ network: "Arc Mainnet", chainId: actualChainId, expectedChainId: chainId, router, result: "WRONG_CHAIN" }));
  process.exit(1);
}
if (!routerCode || routerCode === "0x" || !factoryCode || factoryCode === "0x") {
  console.log(JSON.stringify({ network: "Arc Mainnet", chainId, router, factory, result: "ROUTE_CONTRACT_NOT_DEPLOYED" }));
  process.exit(1);
}
if (boundFactory.toLowerCase() !== factory.toLowerCase()) {
  console.log(JSON.stringify({ network: "Arc Mainnet", chainId, router, factory, boundFactory, result: "ROUTER_FACTORY_MISMATCH" }));
  process.exit(1);
}
if (!isAddress(pair) || pair.toLowerCase() === "0x0000000000000000000000000000000000000000") {
  console.log(JSON.stringify({ network: "Arc Mainnet", chainId, router, factory, result: "PAIR_NOT_REGISTERED" }));
  process.exit(1);
}
const pairCode = await client.getCode({ address: pair });
const amounts = await client.readContract({ address: router, abi: routerAbi, functionName: "getAmountsOut", args: [1_000_000n, [usdc, eurc]] });
const quote = amounts.at(-1) || 0n;
if (!pairCode || pairCode === "0x" || quote <= 0n) {
  console.log(JSON.stringify({ network: "Arc Mainnet", chainId, router, factory, pair, result: "NO_LIVE_QUOTE" }));
  process.exit(1);
}
console.log(JSON.stringify({ network: "Arc Mainnet", chainId, router, factory, pair, quote: quote.toString(), result: "ROUTE_QUOTE_VERIFIED" }));
