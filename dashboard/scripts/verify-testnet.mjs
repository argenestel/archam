// Read-only deployment check for Arc Testnet. No signer or transaction is used.
import { createPublicClient, http, isAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

const rpc = process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.network";
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
const artifacts = {
  orderbook: JSON.parse(readFileSync(new URL("../../contracts/out/MofuOrderBook.sol/MofuOrderBook.json", import.meta.url))),
  v2Factory: JSON.parse(readFileSync(new URL("../../contracts/out/MofuV2.sol/MofuFactoryV2.json", import.meta.url))),
};
const addresses = {
  launchpad: process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || "",
  orderbook: process.env.NEXT_PUBLIC_ORDERBOOK_ADDRESS || "",
  v2Factory: process.env.NEXT_PUBLIC_MOFU_V2_FACTORY || "",
};
const status = {};
for (const [name, address] of Object.entries(addresses)) {
  status[name] = {
    address: address || null,
    valid: isAddress(address),
    deployed: isAddress(address) && (await client.getCode({ address })) !== "0x",
  };
}
if (status.orderbook.deployed && status.launchpad.deployed) {
  const boundFactory = await client.readContract({ address: addresses.orderbook, abi: artifacts.orderbook.abi, functionName: "factory" });
  status.orderbook.boundToLaunchpad = boundFactory.toLowerCase() === addresses.launchpad.toLowerCase();
}
if (status.v2Factory.deployed && process.env.MOFU_DEPLOYER_ADDRESS) {
  const treasury = await client.readContract({ address: addresses.v2Factory, abi: artifacts.v2Factory.abi, functionName: "treasury" });
  status.v2Factory.treasury = treasury;
  status.v2Factory.treasuryMatchesDeployer = treasury.toLowerCase() === process.env.MOFU_DEPLOYER_ADDRESS.toLowerCase();
}
const ready = status.launchpad.deployed && status.orderbook.deployed && status.orderbook.boundToLaunchpad === true && status.v2Factory.deployed && status.v2Factory.treasuryMatchesDeployer !== false;
console.log(JSON.stringify({ network: "Arc Testnet", chainId: await client.getChainId(), contracts: status, result: ready ? "READY" : "MISSING_DEPLOYMENTS" }));
