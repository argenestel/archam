// Deploy every first-class Mofu contract to Arc Testnet.
// The script reuses configured deployments and never accepts a mnemonic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const rpc = process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.network";
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
assert.equal(await publicClient.getChainId(), arcTestnet.id, "RPC is not Arc Testnet (5042002).");

const configured = {
  launchpad: process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || "",
  orderbook: process.env.NEXT_PUBLIC_ORDERBOOK_ADDRESS || "",
  v2Factory: process.env.NEXT_PUBLIC_MOFU_V2_FACTORY || "",
};
for (const [name, address] of Object.entries(configured)) {
  if (address) assert(isAddress(address), `${name} deployment address is invalid.`);
}

const artifacts = {
  launchpad: JSON.parse(readFileSync(new URL("../../contracts/out/CurveLaunchpad.sol/CurveLaunchpad.json", import.meta.url))),
  orderbook: JSON.parse(readFileSync(new URL("../../contracts/out/MofuOrderBook.sol/MofuOrderBook.json", import.meta.url))),
  v2Factory: JSON.parse(readFileSync(new URL("../../contracts/out/MofuV2.sol/MofuFactoryV2.json", import.meta.url))),
};

async function deployed(address) {
  return !!address && (await publicClient.getCode({ address })) !== "0x";
}

const existing = {
  launchpad: await deployed(configured.launchpad),
  orderbook: await deployed(configured.orderbook),
  v2Factory: await deployed(configured.v2Factory),
};

async function verifyRelationships(addresses) {
  if (await deployed(addresses.orderbook)) {
    const boundFactory = await publicClient.readContract({ address: addresses.orderbook, abi: artifacts.orderbook.abi, functionName: "factory" });
    assert.equal(boundFactory.toLowerCase(), addresses.launchpad.toLowerCase(), "Orderbook factory does not match launchpad.");
  }
}

if (existing.launchpad && existing.orderbook && existing.v2Factory) {
  await verifyRelationships(configured);
  console.log(JSON.stringify({
    network: "Arc Testnet",
    chainId: arcTestnet.id,
    contracts: configured,
    result: "ALREADY_DEPLOYED",
  }));
  process.exit(0);
}

const key = process.env.MOFU_DEPLOYER_PRIVATE_KEY;
assert(/^0x[0-9a-fA-F]{64}$/.test(key || ""), "Set MOFU_DEPLOYER_PRIVATE_KEY in the local shell.");
assert.equal(process.env.MOFU_DEPLOY_CONFIRM, "ARC_TESTNET", "Set MOFU_DEPLOY_CONFIRM=ARC_TESTNET to authorize a public testnet deployment.");
const account = privateKeyToAccount(key);
const expected = (process.env.MOFU_DEPLOYER_ADDRESS || "0x1bD1D7476499185dec5cFb0DC77FaA5befe093e2").toLowerCase();
assert.equal(account.address.toLowerCase(), expected, `Signer ${account.address} is not the configured deployer ${expected}.`);
const signerBalance = await publicClient.getBalance({ address: account.address });
assert(signerBalance > 0n, `Signer ${account.address} has no Arc Testnet USDC. Fund it from Circle's faucet first.`);
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpc) });

async function deploy(name, address, artifact, args = []) {
  if (await deployed(address)) return { address, transaction: null, status: "existing" };
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${name} deployment reverted.`);
  assert(receipt.contractAddress, `${name} deployment did not return an address.`);
  return { address: receipt.contractAddress, transaction: hash, status: "deployed" };
}

const launchpad = await deploy("CurveLaunchpad", configured.launchpad, artifacts.launchpad);
const orderbook = await deploy("MofuOrderBook", configured.orderbook, artifacts.orderbook, [launchpad.address]);
const v2Factory = await deploy("MofuFactoryV2", configured.v2Factory, artifacts.v2Factory, [account.address]);
await verifyRelationships({ launchpad: launchpad.address, orderbook: orderbook.address });
const treasury = await publicClient.readContract({ address: v2Factory.address, abi: artifacts.v2Factory.abi, functionName: "treasury" });
assert.equal(treasury.toLowerCase(), account.address.toLowerCase(), "V2 treasury does not match deployment signer.");

console.log(JSON.stringify({
  network: "Arc Testnet",
  chainId: arcTestnet.id,
  deployer: account.address,
  contracts: { launchpad, orderbook, v2Factory },
  env: {
    NEXT_PUBLIC_LAUNCHPAD_ADDRESS: launchpad.address,
    NEXT_PUBLIC_ORDERBOOK_ADDRESS: orderbook.address,
    NEXT_PUBLIC_MOFU_V2_FACTORY: v2Factory.address,
  },
  result: "DEPLOYED",
}));
