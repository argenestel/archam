// Seed the configured Arc Testnet orderbook with a small MOFU demo market.
// The script is deliberately explicit: it only writes with MOFU_ACTIVITY_CONFIRM=ARC_TESTNET.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const UNIT = 10n ** 18n;
const MAX_EXPIRY_HOURS = 30 * 24;
const DEFAULT_EXPIRY_HOURS = 7 * 24;
const EXPLORER = "https://testnet.arcscan.app";

// Prices are native USDC wei per whole MOFU token.
export const DEMO_ORDERS = [
  { label: "ask-near", isBuy: false, quantity: 120n, price: parseUnits("0.0018", 18) },
  { label: "ask-mid", isBuy: false, quantity: 180n, price: parseUnits("0.0024", 18) },
  { label: "ask-wide", isBuy: false, quantity: 240n, price: parseUnits("0.0030", 18) },
  { label: "bid-near", isBuy: true, quantity: 120n, price: parseUnits("0.0012", 18) },
  { label: "bid-mid", isBuy: true, quantity: 180n, price: parseUnits("0.0009", 18) },
  { label: "bid-wide", isBuy: true, quantity: 240n, price: parseUnits("0.0006", 18) },
];

export function summarizeDemoOrders(orders = DEMO_ORDERS) {
  return orders.reduce(
    (summary, order) => {
      if (order.isBuy) {
        summary.bidQuantity += order.quantity;
        summary.bidEscrow += order.quantity * order.price;
      } else {
        summary.askQuantity += order.quantity;
      }
      return summary;
    },
    { askQuantity: 0n, bidQuantity: 0n, bidEscrow: 0n },
  );
}

const artifact = (file, name) =>
  JSON.parse(readFileSync(new URL(`../../contracts/out/${file}.sol/${name}.json`, import.meta.url)));

const launchpadArtifact = artifact("CurveLaunchpad", "CurveLaunchpad");
const tokenArtifact = artifact("CurveLaunchpad", "CurveToken");
const orderbookArtifact = artifact("MofuOrderBook", "MofuOrderBook");

const addressFromEnv = (name) => {
  const value = (process.env[name] || "").trim();
  assert(isAddress(value), `Set a valid ${name}.`);
  return value;
};

const deployed = async (client, address, name) => {
  assert.notEqual(await client.getCode({ address }), "0x", `${name} is not deployed.`);
};

const parseExpiryHours = () => {
  const raw = process.env.MOFU_ACTIVITY_EXPIRY_HOURS || String(DEFAULT_EXPIRY_HOURS);
  assert(/^\d+$/.test(raw), "MOFU_ACTIVITY_EXPIRY_HOURS must be a positive integer.");
  const hours = Number(raw);
  assert(hours > 0 && hours <= MAX_EXPIRY_HOURS, `Expiry must be between 1 and ${MAX_EXPIRY_HOURS} hours.`);
  return hours;
};

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

async function main() {
  const rpc = process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.network";
  const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) });
  const launchpad = addressFromEnv("NEXT_PUBLIC_LAUNCHPAD_ADDRESS");
  const orderbook = addressFromEnv("NEXT_PUBLIC_ORDERBOOK_ADDRESS");
  const dryRun = process.env.MOFU_ACTIVITY_DRY_RUN === "1";
  const allowExisting = process.env.MOFU_ACTIVITY_ALLOW_EXISTING === "1";
  const expiryHours = parseExpiryHours();

  const privateKey = (process.env.MOFU_DEPLOYER_PRIVATE_KEY || "").trim();
  assert(!privateKey || /^0x[0-9a-fA-F]{64}$/.test(privateKey), "MOFU_DEPLOYER_PRIVATE_KEY is invalid.");
  const signer = privateKey ? privateKeyToAccount(privateKey) : undefined;
  const configuredSigner = (process.env.MOFU_DEPLOYER_ADDRESS || signer?.address || "").trim();
  assert(isAddress(configuredSigner), "Set MOFU_DEPLOYER_ADDRESS or provide MOFU_DEPLOYER_PRIVATE_KEY.");
  if (signer) {
    assert.equal(signer.address.toLowerCase(), configuredSigner.toLowerCase(), "Signer does not match MOFU_DEPLOYER_ADDRESS.");
  }

  assert.equal(await client.getChainId(), arcTestnet.id, "RPC is not Arc Testnet (5042002).");
  await deployed(client, launchpad, "Launchpad");
  await deployed(client, orderbook, "Orderbook");

  const boundFactory = await client.readContract({
    address: orderbook,
    abi: orderbookArtifact.abi,
    functionName: "factory",
  });
  assert.equal(boundFactory.toLowerCase(), launchpad.toLowerCase(), "Orderbook is bound to a different launchpad.");

  const tokenCount = await client.readContract({
    address: launchpad,
    abi: launchpadArtifact.abi,
    functionName: "tokenCount",
  });
  const requestedToken = (process.env.MOFU_ACTIVITY_TOKEN_ADDRESS || "").trim();
  const candidates = [];
  for (let index = 0n; index < tokenCount; index += 1n) {
    const token = await client.readContract({
      address: launchpad,
      abi: launchpadArtifact.abi,
      functionName: "tokens",
      args: [index],
    });
    if (requestedToken && token.toLowerCase() !== requestedToken.toLowerCase()) continue;
    const [name, symbol] = await Promise.all([
      client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "name" }),
      client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "symbol" }),
    ]);
    if (requestedToken || symbol.toUpperCase() === "MOFU") {
      candidates.push({ index, address: token, name, symbol });
    }
  }
  assert.equal(candidates.length, 1, requestedToken
    ? "MOFU_ACTIVITY_TOKEN_ADDRESS is not registered in the configured launchpad."
    : `Expected exactly one MOFU token in the configured launchpad; found ${candidates.length}. Set MOFU_ACTIVITY_TOKEN_ADDRESS to disambiguate.`);
  const token = candidates[0];

  const summary = summarizeDemoOrders();
  const [block, orderCount, nativeBalance, tokenBalance, allowance] = await Promise.all([
    client.getBlock(),
    client.readContract({ address: orderbook, abi: orderbookArtifact.abi, functionName: "orderCount" }),
    client.getBalance({ address: configuredSigner }),
    client.readContract({ address: token.address, abi: tokenArtifact.abi, functionName: "balanceOf", args: [configuredSigner] }),
    client.readContract({ address: token.address, abi: tokenArtifact.abi, functionName: "allowance", args: [configuredSigner, orderbook] }),
  ]);
  assert(allowExisting || orderCount === 0n, `Orderbook already has ${orderCount} orders. Set MOFU_ACTIVITY_ALLOW_EXISTING=1 to add another ladder.`);

  const currentWhole = tokenBalance / UNIT;
  const tokensToBuy = summary.askQuantity > currentWhole ? summary.askQuantity - currentWhole : 0n;
  const curveCost = tokensToBuy
    ? await client.readContract({ address: token.address, abi: tokenArtifact.abi, functionName: "quoteBuy", args: [tokensToBuy] })
    : 0n;
  const requiredNative = curveCost + summary.bidEscrow;
  assert(nativeBalance > requiredNative, `Signer needs more native USDC than ${formatUnits(requiredNative, 18)} for this activity.`);
  const expiry = block.timestamp + BigInt(expiryHours) * 3600n;
  const plan = {
    network: "Arc Testnet",
    chainId: arcTestnet.id,
    signer: configuredSigner,
    launchpad,
    orderbook,
    token: { index: token.index.toString(), address: token.address, name: token.name, symbol: token.symbol },
    currentOrderCount: orderCount.toString(),
    expiry: new Date(Number(expiry) * 1000).toISOString(),
    funding: {
      currentTokens: formatUnits(tokenBalance, 18),
      tokensToBuy: tokensToBuy.toString(),
      curveCost: formatUnits(curveCost, 18),
      bidEscrow: formatUnits(summary.bidEscrow, 18),
    },
    orders: DEMO_ORDERS.map(order => ({
      label: order.label,
      side: order.isBuy ? "bid" : "ask",
      quantity: order.quantity.toString(),
      price: formatUnits(order.price, 18),
    })),
  };
  console.log(JSON.stringify({ ...plan, result: dryRun ? "DRY_RUN" : "READY_TO_WRITE" }, null, 2));
  if (dryRun) return;

  assert.equal(process.env.MOFU_ACTIVITY_CONFIRM, "ARC_TESTNET", "Set MOFU_ACTIVITY_CONFIRM=ARC_TESTNET to authorize testnet writes.");
  assert(signer, "Set MOFU_DEPLOYER_PRIVATE_KEY to send testnet transactions.");
  const wallet = createWalletClient({ account: signer, chain: arcTestnet, transport: http(rpc) });
  const transactions = [];

  const send = async (address, abi, functionName, args = [], value = 0n) => {
    const { request } = await client.simulateContract({
      address,
      abi,
      functionName,
      args,
      account: signer.address,
      value,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", `${functionName} transaction reverted.`);
    transactions.push({ functionName, hash, url: `${EXPLORER}/tx/${hash}` });
    return receipt;
  };

  if (tokensToBuy) {
    const latest = await client.getBlock();
    await send(
      token.address,
      tokenArtifact.abi,
      "buy",
      [tokensToBuy, curveCost, latest.timestamp + 900n],
      curveCost,
    );
  }
  const requiredApproval = summary.askQuantity * UNIT;
  if (allowance < requiredApproval) {
    await send(token.address, tokenArtifact.abi, "approve", [orderbook, requiredApproval]);
  }

  const created = [];
  for (const order of DEMO_ORDERS) {
    const receipt = await send(
      orderbook,
      orderbookArtifact.abi,
      "postOrder",
      [token.index, order.isBuy, order.quantity, order.price, expiry],
      order.isBuy ? order.quantity * order.price : 0n,
    );
    const id = orderCount + BigInt(created.length);
    created.push({
      id: id.toString(),
      label: order.label,
      side: order.isBuy ? "bid" : "ask",
      quantity: order.quantity.toString(),
      price: formatUnits(order.price, 18),
      transaction: receipt.transactionHash,
      url: `${EXPLORER}/tx/${receipt.transactionHash}`,
    });
  }

  const finalOrderCount = await client.readContract({
    address: orderbook,
    abi: orderbookArtifact.abi,
    functionName: "orderCount",
  });
  assert.equal(finalOrderCount, orderCount + BigInt(DEMO_ORDERS.length), "Unexpected final order count.");
  console.log(JSON.stringify({
    network: "Arc Testnet",
    token: token.address,
    orderbook,
    orders: created,
    transactions,
    result: "SEEDED_MOFU_ORDERBOOK_ACTIVITY",
  }, null, 2));
}

if (isMain) await main();
