import { expect, test } from '@playwright/test';

// Read-only checks against live Arc testnet state through the same-origin RPC proxy.
const pages = ['', 'swap', 'lend', 'leaders', 'portfolio', 'create', 'risks', 'bridge'];
const widths = [360, 390, 768, 1280, 1440];

test('every page renders without errors or horizontal overflow', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of pages) {
      await page.goto(`/#/${route}`);
      await expect(page.locator('main :is(h1, h3)').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route || 'discover'} @ ${width}px`).toBeLessThanOrEqual(0);
    }
  }
  expect(errors).toEqual([]);
});

test('discover lists launches from the chain and opens a token', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('a.launch-row').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/#\/token\/0x/);
  await expect(page.getByRole('tab', { name: 'Buy' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trades' })).toBeVisible();
});

test('copy-trade links prefill the buy amount', async ({ page }) => {
  await page.goto('/');
  const copy = page.getByRole('link', { name: /Copy this buy/ }).first();
  await expect(copy).toBeVisible({ timeout: 30_000 });
  await copy.click();
  await expect(page.getByLabel('You pay')).not.toHaveValue('');
});

test('lending market shows live Morpho state', async ({ page }) => {
  await page.goto('/#/lend');
  await expect(page.getByText('Supply APY')).toBeVisible();
  await expect(page.getByText(/1 tETH = /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
});

test('without a wallet, actions ask to connect and the picker explains why', async ({ page }) => {
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect a wallet' })).toContainText('No browser wallet detected');
});

test('wrong network asks to switch instead of trading', async ({ page }) => {
  await page.addInitScript(() => {
    const provider = {
      request: async ({ method }: { method: string }) =>
        method === 'eth_chainId' ? '0x1' : method.endsWith('ccounts') ? ['0x000000000000000000000000000000000000beef'] : null,
      on() {},
      removeListener() {},
    };
    window.addEventListener('eip6963:requestProvider', () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: { info: { rdns: 'test.wrong', name: 'Wrong Net', uuid: '2', icon: '' }, provider },
        }),
      ),
    );
  });
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: /Wrong Net/ }).click();
  await expect(page.locator('.btn-block')).toHaveText('Switch to Arc');
});
