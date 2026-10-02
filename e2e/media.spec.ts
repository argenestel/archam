import { expect, test } from '@playwright/test';

const address = '0x000000000000000000000000000000000000beef';
test('public profile renders IPFS metadata and falls back when avatar cannot load', async ({
  page,
}) => {
  await page.route('**/api/media/profiles/*', (route) =>
    route.fulfill({
      json: {
        address,
        name: 'Arc Alice',
        bio: 'Trading on Arc',
        avatar: 'ipfs://bafyTestCid123',
        website: 'https://example.com',
        uri: 'ipfs://bafyProfile123',
      },
    }),
  );
  await page.route('https://gateway.pinata.cloud/**', (route) => route.abort());
  await page.goto(`/#/profile/${address}`);
  await expect(page.getByRole('heading', { name: 'Arc Alice' })).toBeVisible();
  await expect(page.getByText('Trading on Arc')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View profile metadata on IPFS' })).toHaveAttribute(
    'href',
    'https://gateway.pinata.cloud/ipfs/bafyProfile123',
  );
  await expect(page.locator('main svg.avatar')).toBeVisible();
});

test('mobile launches expose cards, market cap, network and launch action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.launch-tile').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.launch-tile').first().getByText('Market cap')).toBeVisible();
  await expect(page.locator('.net-pill')).toBeVisible();
  await page.locator('.mobile-launch').click();
  await expect(page.getByText('Token logo (optional)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect to upload' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('disconnected personal profile asks to connect', async ({ page }) => {
  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
});
