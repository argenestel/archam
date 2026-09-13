// Start `pnpm dev` first. No wallet signatures or public-chain writes.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.UI_URL || 'http://localhost:3000');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Swap coins' })).toBeVisible();
  await page.getByLabel('Swap route', { exact: true }).selectOption('coins');
  await page.getByLabel(/You receive/).fill('1.5');
  await expect(page.getByText('Enter 1–1,000,000 whole tokens.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Coin', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Mofu (MOFU)', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Euro Coin (EURC)', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Euro Coin (EURC)', exact: true }).click();
  await expect(page.getByText(/no verified liquidity route/i)).toBeVisible();
  await page.getByLabel('Swap route', { exact: true }).selectOption('stablecoins');
  await expect(page.getByRole('heading', { name: 'Swap stablecoins' })).toBeVisible();
  await page.getByRole('button', { name: 'Reverse direction' }).click();
  await expect(page.locator('#trade-amount')).toBeVisible();
  await page.getByLabel('Swap route', { exact: true }).selectOption('mainnet');
  await expect(page.getByRole('heading', { name: 'Swap tokens' })).toBeVisible();
  await expect(page.getByText(/ArcSwap DEX/)).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ['Explore', 'Launch', 'Trade', 'Portfolio', 'Swap', 'Bridge', 'Privacy']) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `${tab} overflows at ${width}px`).toBe(false);
    }
  }
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Mofu', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('PASS: tab navigation, Arc token modal/detection state, legacy/V2 routes, Radix dialog, amount validation, and responsive layouts.');
} finally { await browser.close(); }
