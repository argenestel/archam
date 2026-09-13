// Local-only browser integration test. Uses Anvil account 0 as the deployer/trader.
// Requires: anvil --chain-id 5042002 --port 8547 and pnpm dev.
import { chromium, expect } from "@playwright/test";
import { createPublicClient, createWalletClient, defineChain, http, parseUnits } from "viem";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const rpc = process.env.MOFU_LOCAL_RPC || "http://127.0.0.1:8547";
const rpcUrl = new URL(rpc);
assert(["127.0.0.1", "[::1]"].includes(rpcUrl.hostname), "RPC must use loopback");
assert.equal(rpcUrl.username, "");
assert.equal(rpcUrl.password, "");

async function request(method, params = []) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

assert.match((await request("web3_clientVersion")).toLowerCase(), /^anvil\b/);
assert.equal(await request("eth_chainId"), "0x4cef52");

const chain = defineChain({
  id: 5042002,
  name: "Local Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc) });
const [deployer] = await wallet.getAddresses();
assert(deployer, "Anvil deployer account is required");

const artifact = name => JSON.parse(readFileSync(new URL(`../../contracts/out/MofuV2.sol/${name}.json`, import.meta.url)));
const factoryArtifact = artifact("MofuFactoryV2");
const tokenArtifact = artifact("MofuTokenV2");
const poolArtifact = artifact("MofuPool");
const quoteArtifact = JSON.parse(readFileSync(new URL("../../contracts/out/MofuV2.t.sol/MockQuote.json", import.meta.url)));
const mined = async hash => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
};

const quote = (await mined(await wallet.deployContract({
  account: deployer, abi: quoteArtifact.abi, bytecode: quoteArtifact.bytecode.object, args: [6],
}))).contractAddress;
await mined(await wallet.writeContract({
  account: deployer, address: quote, abi: quoteArtifact.abi, functionName: "mint", args: [deployer, parseUnits("1000000", 6)],
}));
const factory = (await mined(await wallet.deployContract({
  account: deployer, abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode.object, args: [deployer],
}))).contractAddress;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let authorized = false;
  await page.exposeFunction("localWalletRequest", async ({ method, params = [] }) => {
    if (method === "eth_accounts") return authorized ? [deployer] : [];
    if (method === "eth_requestAccounts") { authorized = true; return [deployer]; }
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
    if (method === "wallet_getPermissions" || method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
    return request(method, params);
  });
  await page.addInitScript(({ factory }) => {
    localStorage.setItem("mofu-v2-factory", factory);
    window.ethereum = {
      isMetaMask: true,
      request: args => window.localWalletRequest(args),
      on() {},
      removeListener() {},
    };
  }, { factory });

  await page.route("**/*", async route => {
    const requestInfo = route.request();
    let body;
    try { body = requestInfo.postDataJSON(); } catch {}
    const isRpc = body && (Array.isArray(body) ? body[0]?.jsonrpc : body.jsonrpc);
    if (!isRpc) return route.continue();
    const call = async item => {
      try { return { jsonrpc: "2.0", id: item.id, result: await request(item.method, item.params || []) }; }
      catch (error) { return { jsonrpc: "2.0", id: item.id, error: { code: -32000, message: error.message } }; }
    };
    const result = Array.isArray(body) ? await Promise.all(body.map(call)) : await call(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });

  await page.goto(`${process.env.UI_URL || "http://localhost:3000"}/?tab=Launch`);
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).click();
  await page.getByRole("button", { name: /Browser Wallet/i }).first().click();
  await page.getByRole("button", { name: "Launch graduating token", exact: true }).click();
  await page.getByLabel("Token name", { exact: true }).fill("UI Graduation");
  await page.getByLabel("Token symbol", { exact: true }).fill("UIGRAD");
  await page.getByLabel("Token image URL", { exact: true }).fill("/token-images/mofu.svg");
  await page.getByLabel("Quote asset address", { exact: true }).fill(quote);
  await page.getByRole("button", { name: "Create graduating token", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Token launched", { timeout: 30000 });

  const token = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "tokens", args: [0n] });
  assert.equal(await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "imageURI" }), "/token-images/mofu.svg");
  await expect(page.getByText("Bonding curve", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Fill remaining curve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm curve trade", exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm curve trade", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Token graduated", { timeout: 30000 });

  const graduated = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "graduated" });
  const pool = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "pool" });
  const [quoteReserve, tokenReserve] = await client.readContract({ address: pool, abi: poolArtifact.abi, functionName: "reserves" });
  assert.equal(graduated, true);
  assert.notEqual(pool, "0x0000000000000000000000000000000000000000");
  assert.equal(await client.readContract({ address: pool, abi: poolArtifact.abi, functionName: "locked" }), true);
  assert(quoteReserve > 0n && tokenReserve > 0n, "graduation must seed both pool reserves");

  await expect(page.getByText("Pool live", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm pool swap", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Pool swap confirmed", { timeout: 30000 });
  const tokenAfterBuy = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [deployer] });
  const quoteAfterBuy = await client.readContract({ address: quote, abi: quoteArtifact.abi, functionName: "balanceOf", args: [deployer] });
  assert(tokenAfterBuy > 0n, "pool buy must credit tokens");

  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(page.locator(".v2-ticket label")).toContainText("(UIGRAD sent)");
  await expect(page.locator('[aria-label="V2 trade amount"]')).toHaveValue("1");
  await expect(page.getByRole("button", { name: "Confirm pool swap", exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm pool swap", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Pool swap confirmed", { timeout: 30000 });
  const tokenAfterSell = await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [deployer] });
  const quoteAfterSell = await client.readContract({ address: quote, abi: quoteArtifact.abi, functionName: "balanceOf", args: [deployer] });
  assert(tokenAfterSell < tokenAfterBuy, "pool sell must debit tokens");
  assert(quoteAfterSell > quoteAfterBuy, "pool sell must return quote asset");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Swap", exact: true }).click();
  await expect(page.getByLabel("Swap route", { exact: true })).toHaveValue("v2");
  await page.getByRole("combobox", { name: "V2 coin", exact: true }).click();
  await expect(page.getByRole("option", { name: "UI Graduation (UIGRAD)", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ rpc, chainId: chain.id, signer: deployer, quote, factory, token, pool, reserves: { quote: quoteReserve.toString(), token: tokenReserve.toString() }, tokenAfterBuy: tokenAfterBuy.toString(), tokenAfterSell: tokenAfterSell.toString(), quoteAfterSell: quoteAfterSell.toString(), result: "PASS: UI deploy, curve buyout, graduation, locked pool, pool buy/sell, and V2 token modal" }));
} finally {
  await browser.close();
}
