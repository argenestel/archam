// Local-only end-to-end test: deploy a coin, then use the actual Swap UI to buy/sell.
// Requires Anvil on 127.0.0.1:8547 (chain 5042002) and `pnpm dev`.
import { chromium, expect } from '@playwright/test';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const rpc = 'http://127.0.0.1:8547';
async function request(method, params = []) {
  const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
if (!(await request('web3_clientVersion')).toLowerCase().includes('anvil')) throw new Error('Only Anvil is allowed.');
if (await request('eth_chainId') !== '0x4cef52') throw new Error('Start Anvil with --chain-id 5042002.');
const chain = defineChain({ id: 5042002, name: 'Local Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc) });
const [account] = await wallet.getAddresses();
// Arc provides Multicall3, while a fresh local Anvil chain may not.
const multicall = '0xcA11bde05977b3631167028862bE2a173976CA11';
if (!await client.getCode({ address: multicall })) {
  const require = createRequire(import.meta.url);
  const { multicall3Bytecode } = require(join(dirname(require.resolve('viem')), 'constants/contracts.js'));
  const { data } = await client.call({ data: multicall3Bytecode });
  await request('anvil_setCode', [multicall, data]);
}
const artifact = name => JSON.parse(readFileSync(new URL(`../../contracts/out/CurveLaunchpad.sol/${name}.json`, import.meta.url)));
const factoryArtifact = artifact('CurveLaunchpad');
const tokenArtifact = artifact('CurveToken');
const mined = hash => client.waitForTransactionReceipt({ hash });
const factory = (await mined(await wallet.deployContract({ account, abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode.object }))).contractAddress;
await mined(await wallet.writeContract({ account, address: factory, abi: factoryArtifact.abi, functionName: 'createToken', args: ['Test Mochi', 'MOCHI', 'Local UI test coin', '/token-images/mofu.svg'] }));
const token = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'tokens', args: [0n] });
let configured = '';
try { configured = readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^NEXT_PUBLIC_LAUNCHPAD_ADDRESS=(.*)$/m)?.[1]?.trim() || ''; } catch {}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  let authorized = false;
  await page.exposeFunction('localWalletRequest', async ({ method, params }) => {
    if (method === 'eth_accounts' && !authorized) return [];
    if (method === 'eth_requestAccounts') authorized = true;
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
    return request(method === 'eth_requestAccounts' ? 'eth_accounts' : method, params);
  });
  await page.addInitScript(({ factory }) => {
    localStorage.setItem('mofu-curve-market-v1', factory);
    window.ethereum = { isMetaMask: true, request: args => window.localWalletRequest(args), on() {}, removeListener() {} };
  }, { factory });
  // Redirect browser read RPCs to Anvil. No public chain is read or written by this test.
  await page.route('**/*', async route => {
    const req = route.request();
    let body;
    try { body = req.postDataJSON(); } catch {}
    if (!body || !(Array.isArray(body) ? body[0]?.jsonrpc : body.jsonrpc)) return route.continue();
    const handle = async call => {
      const params = structuredClone(call.params || []);
      if (configured && params[0]?.to?.toLowerCase() === configured.toLowerCase()) params[0].to = factory;
      try { return { jsonrpc: '2.0', id: call.id, result: await request(call.method, params) }; }
      catch (e) { console.error(call.method, e.message); return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: e.message } }; }
    };
    const result = Array.isArray(body) ? await Promise.all(body.map(handle)) : await handle(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto(`${process.env.UI_URL || 'http://localhost:3000'}/?tab=Launch`);
  await page.getByLabel('Swap route', { exact: true }).selectOption('coins');
  await page.locator('.header-actions').getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await page.getByRole('button', { name: /Browser Wallet/i }).first().click();
  await page.getByRole('button', { name: 'Select Test Mochi', exact: true }).click();
  await page.getByRole('button', { name: 'Swap MOCHI with USDC', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Coin', exact: true })).toHaveText('Test Mochi (MOCHI)');
  await page.getByRole('combobox', { name: 'Coin', exact: true }).click();
  await page.getByRole('option', { name: 'Test Mochi (MOCHI)', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm swap', exact: true }).click();
  await expect(page.getByText('Swapped USDC for 100 MOCHI.')).toBeVisible({ timeout: 30000 });
  expect(await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [account] })).toBe(100n * 10n ** 18n);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.locator('.pf-section').getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Coin', exact: true })).toHaveText('Test Mochi (MOCHI)');
  await page.getByRole('radio', { name: 'Coin to USDC', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm swap', exact: true }).click();
  await expect(page.getByText('Swapped to USDC from 100 MOCHI.')).toBeVisible({ timeout: 30000 });
  expect(await client.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [account] })).toBe(0n);
  console.log('PASS: Launch → Swap buy → Portfolio → Swap sell, with verified coin selection and onchain balances.');
} finally { await browser.close(); }
