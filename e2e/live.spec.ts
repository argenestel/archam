import { expect, test, type Page } from '@playwright/test';
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
});

// Opt-in: drives the real UI against Arc testnet and signs real testnet transactions with
// ORBIT_E2E_PRIVATE_KEY (a throwaway funded key). Never point this at a key holding value.
const key = process.env.ORBIT_E2E_PRIVATE_KEY as Hex | undefined;
test.skip(!key || process.env.ORBIT_LIVE_E2E !== '1', 'live testnet e2e is opt-in');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const rpc = http('https://rpc.testnet.arc.io', { timeout: 30_000 });
const pub = createPublicClient({ chain: arcTestnet, transport: rpc });

async function injectWallet(page: Page) {
  const account = privateKeyToAccount(key!);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: rpc });
  await page.exposeFunction('__orbitSigner', async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address];
      case 'eth_chainId':
        return '0x4cef52';
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null;
      case 'eth_sendTransaction': {
        const tx = (params as Record<string, Hex>[])[0];
        return wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : undefined,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
        });
      }
      default:
        return pub.request({ method: method as never, params: params as never });
    }
  });
  await page.addInitScript(() => {
    const provider = {
      request: (args: unknown) => (window as unknown as { __orbitSigner: (a: unknown) => Promise<unknown> }).__orbitSigner(args),
      on() {},
      removeListener() {},
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: { info: { rdns: 'test.orbit', name: 'Orbit Test Signer', uuid: '1', icon: '' }, provider },
        }),
      );
    window.addEventListener('eip6963:requestProvider', announce);
  });
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: /Orbit Test Signer/ }).click();
  await expect(page.getByRole('button', { name: /^Wallet 0x/ })).toBeVisible();
}
/** Clicks the primary action until it reaches `final` (approvals are separate clicks). */
async function act(page: Page, final: string | RegExp) {
  for (let i = 0; i < 3; i++) {
    const btn = page.locator('.btn-block').first();
    await expect(btn).toBeEnabled({ timeout: 60_000 });
    const label = (await btn.textContent()) ?? '';
    await btn.click();
    await expect(page.locator('.toast.success').last()).toBeVisible({ timeout: 90_000 });
    await page.locator('.toast .icon-btn').first().click().catch(() => undefined);
    if (typeof final === 'string' ? label.includes(final) : final.test(label)) return;
  }
  throw new Error(`Never reached ${final}`);
}

test('launch, buy and sell a token through the UI', async ({ page }) => {
  await injectWallet(page);
  await page.goto('/#/create');
  await connect(page);
  const symbol = `E${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await page.getByLabel('Name').fill('E2E Orbit');
  await page.getByLabel('Ticker').fill(symbol);
  await page.getByLabel('Description').fill('Created by the live e2e suite.');
  await act(page, 'Launch token');
  await expect(page).toHaveURL(/#\/token\/0x/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: new RegExp(symbol) })).toBeVisible();

  await page.getByLabel('You pay').fill('0.25');
  await expect(page.getByText(/You receive/).locator('..').getByText(new RegExp(symbol))).toBeVisible();
  await act(page, `Buy ${symbol}`);
  await expect(page.getByRole('cell', { name: 'Buy' }).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: 'Sell' }).click();
  await page.getByRole('button', { name: '50%' }).click();
  await act(page, `Sell ${symbol}`);
  await expect(page.getByRole('cell', { name: 'Sell' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Your position')).toBeVisible();
});

test('claim test assets and swap on the V2 router', async ({ page }) => {
  await injectWallet(page);
  await page.goto('/#/swap');
  await connect(page);
  for (const sym of ['tUSDC', 'tETH']) {
    const claim = page.getByRole('button', { name: new RegExp(`^(Claim ${sym}|${sym} claimed)$`) });
    await expect(claim).toBeEnabled({ timeout: 30_000 }).catch(() => undefined);
    if ((await claim.textContent()) === `Claim ${sym}`) {
      await claim.click();
      await expect(page.getByRole('button', { name: `${sym} claimed` })).toBeVisible({ timeout: 90_000 });
    }
  }
  await page.getByLabel('You pay').fill('25');
  await expect(page.getByText('tUSDC → tETH')).toBeVisible({ timeout: 30_000 });
  await act(page, /^Swap$/);
});

test('supply collateral, borrow, repay and withdraw on Morpho', async ({ page }) => {
  await injectWallet(page);
  await page.goto('/#/lend');
  await connect(page);
  await page.getByRole('tab', { name: 'Borrow' }).click();
  await page.getByRole('button', { name: 'Add collateral' }).click();
  await page.getByLabel('Add collateral').fill('0.5');
  await act(page, 'Add collateral');
  await page.getByRole('button', { name: 'Borrow', exact: true }).click();
  await page.getByLabel('Borrow').fill('200');
  await act(page, /^Borrow$/);
  await expect(page.getByText(/Borrowed/).locator('..')).toContainText('200');
  await page.getByRole('button', { name: 'Repay' }).click();
  await page.locator('.amount-box').getByRole('button', { name: 'Max' }).click();
  await act(page, /^Repay$/);
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.locator('.amount-box').getByRole('button', { name: 'Max' }).click();
  await act(page, /^Remove$/);
  await expect(page.getByText(/Collateral/).locator('..').first()).toContainText('0 tETH');
});
