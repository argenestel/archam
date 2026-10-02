import { expect, test } from '@playwright/test';
// Read-only: no funded accounts, no real signatures, and no broadcasts.

test('mainnet hub, swap, earn and borrow render across viewport sizes', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['', 'swap', 'lend', 'borrow', 'portfolio', 'risks']) {
      await page.goto(`/#/${route}`);
      await expect(page.getByRole('link', { name: 'Orbit home', exact: true })).toBeVisible();
      await expect(page.locator('main :is(h1,h3)').first()).toBeVisible();
      await page.waitForTimeout(600);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        `${route} at ${width}`,
      ).toBe(0);
    }
  }
  expect(errors).toEqual([]);
});
test('mainnet shows verified routers and disables custom launches', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arc mainnet' })).toBeVisible();
  await expect(page.getByText('UniswapUniversalRouter212', { exact: true })).toBeVisible();
  await expect(page.getByText('Wallet execution enabled', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Launch a token' })).toHaveCount(0);
  await page.goto('/#/create');
  await expect(page.getByText('Launches are not available on this network yet.')).toBeVisible();
});
test('mainnet discovers live vaults and collateralized markets without a signer', async ({
  page,
}) => {
  await page.goto('/#/lend');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show all discovered vaults' }).click();
  await page.getByRole('button', { name: 'EURC', exact: true }).click();
  await expect(page.getByText('Deposits (EURC)', { exact: true })).toBeVisible();
  await page.goto('/#/borrow');
  await expect(
    page.locator('table tbody tr').filter({ hasText: 'cirBTC → USDC' }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Liquidation LTV', { exact: true })).toBeVisible();
});
test('read-only wallet obtains an exact six-decimal mainnet USDC/EURC quote', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://api.circle.com/'))
      requests.push(`${request.url()} ${request.postData() || ''}`);
  });
  await page.addInitScript(() => {
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        if (method.endsWith('ccounts')) return ['0x000000000000000000000000000000000000beef'];
        if (/send|sign/i.test(method)) throw new Error('No mainnet writes allowed in this test');
        if (method.startsWith('wallet_')) return {};
        const response = await fetch('/api/arc-rpc-mainnet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }),
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error.message);
        return result.result;
      },
      on() {},
      removeListener() {},
    };
    window.addEventListener('eip6963:requestProvider', () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: { rdns: 'test.quote', name: 'Read-only Wallet', uuid: 'quote', icon: '' },
            provider,
          },
        }),
      ),
    );
  });
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Read-only Wallet', exact: true }).click();
  await page.getByLabel('You pay').fill('0.123456');
  await expect(page.getByText('Minimum received', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Circle's wire API serializes token amounts in base units; 0.123456 USDC is 123456, not 120000.
  expect(requests.some((r) => r.includes('0.123456') || r.includes('123456'))).toBe(true);
  await expect(page.locator('main .btn-block')).toHaveText('Insufficient USDC');
});

test('wrong network asks to switch, never tries to transact', async ({ page }) => {
  await page.addInitScript(() => {
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x1';
        if (method.endsWith('ccounts')) return ['0x000000000000000000000000000000000000beef'];
        if (/send|sign/i.test(method)) throw new Error('Test must not broadcast or sign');
        return null;
      },
      on() {},
      removeListener() {},
    };
    window.addEventListener('eip6963:requestProvider', () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: { rdns: 'test.mainnet', name: 'Test Wallet', uuid: 'mainnet', icon: '' },
            provider,
          },
        }),
      ),
    );
  });
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Test Wallet', exact: true }).click();
  await expect(page.locator('main .btn-block')).toHaveText('Switch to Arc');
  await expect(page.getByLabel('Pay token')).toHaveValue('USDC');
  await expect(page.getByLabel('Receive token')).toHaveValue('EURC');
});
