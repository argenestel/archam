import { test, expect } from '@playwright/test';
import { mockRpc } from './support/rpc';
test('failed primary RPC falls back without leaking raw errors', async ({ page }) => {
  let fallbackRequests = 0;
  await page.route('**/api/arc-rpc*', (route) => {
    if (new URL(route.request().url()).pathname === '/api/arc-rpc') return route.abort('failed');
    fallbackRequests++;
    return mockRpc(route);
  });
  await page.goto('/');
  await expect(page.getByLabel('Arc connected', { exact: true })).toBeVisible();
  await page.getByText('Pool & contract details', { exact: true }).click();
  await expect(page.locator('.pool-ratio')).toContainText('2,684.32');
  expect(fallbackRequests).toBeGreaterThan(0);
  await expect(page.getByText('HTTP request failed', { exact: false })).toHaveCount(0);
});
test('all endpoints unavailable gives an actionable retry and recovers', async ({ page }) => {
  let offline = true;
  await page.route('**/api/arc-rpc*', (route) =>
    offline ? route.abort('failed') : mockRpc(route),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Arc connection unavailable');
  await expect(page.getByRole('alert')).not.toContainText('Request body');
  await expect(page.getByRole('button', { name: 'Approve tUSDC', exact: true })).toHaveCount(0);
  offline = false;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByLabel('Arc connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('live workspace fits mobile without horizontal overflow', async ({ page }) => {
  await page.route('**/api/arc-rpc*', (route) => mockRpc(route));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Arc connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Swap', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByText('Pool & contract details', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inside the pool' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
