// Deploy the V2 factory to Arc Testnet. This script requires an explicit signer.
// It never accepts a mnemonic or broadcasts to a chain other than Arc Testnet.
import { createPublicClient, createWalletClient, erc20Abi, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const rpc = process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.network";
const key = process.env.MOFU_DEPLOYER_PRIVATE_KEY;
assert(/^0x[0-9a-fA-F]{64}$/.test(key || ""), "Set MOFU_DEPLOYER_PRIVATE_KEY to the deployer key in your local shell.");
assert.equal(process.env.MOFU_DEPLOY_CONFIRM, "ARC_TESTNET", "Set MOFU_DEPLOY_CONFIRM=ARC_TESTNET to authorize a public testnet deployment.");

const account = privateKeyToAccount(key);
const expected = (process.env.MOFU_DEPLOYER_ADDRESS || "0x1bD1D7476499185dec5cFb0DC77FaA5befe093e2").toLowerCase();
assert.equal(account.address.toLowerCase(), expected, `Signer ${account.address} is not the configured deployer ${expected}.`);

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
assert.equal(await publicClient.getChainId(), arcTestnet.id, "RPC is not Arc Testnet (5042002).");
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpc) });
const quote = "0x3600000000000000000000000000000000000000";
const [quoteSymbol, quoteDecimals] = await Promise.all([
  publicClient.readContract({ address: quote, abi: erc20Abi, functionName: "symbol" }),
  publicClient.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }),
]);
const artifact = JSON.parse(readFileSync(new URL("../../contracts/out/MofuV2.sol/MofuFactoryV2.json", import.meta.url)));
const existing = process.env.NEXT_PUBLIC_MOFU_V2_FACTORY;
if (existing && await publicClient.getCode({ address: existing }) !== "0x") {
  console.log(JSON.stringify({ network: "Arc Testnet", chainId: arcTestnet.id, deployer: account.address, factory: existing, quote, quoteSymbol, quoteDecimals, result: "ALREADY_DEPLOYED" }));
  process.exit(0);
}
const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [account.address] });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success", "Factory deployment reverted.");
assert(receipt.contractAddress, "Factory deployment did not return an address.");
console.log(JSON.stringify({ network: "Arc Testnet", chainId: arcTestnet.id, deployer: account.address, factory: receipt.contractAddress, transaction: hash, quote, quoteSymbol, quoteDecimals, env: `NEXT_PUBLIC_MOFU_V2_FACTORY=${receipt.contractAddress}`, result: "DEPLOYED" }));
