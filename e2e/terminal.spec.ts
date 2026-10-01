import { test, expect } from '@playwright/test';

test('swap, supply, withdraw, launch, portfolio and XP persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your next move starts here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Review swap' }).click();
  await page.getByRole('button', { name: 'Simulate swap' }).click();
  await expect(page.locator('.toast')).toContainText('+25 demo XP');
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await page.getByRole('button', { name: 'Supply', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate supply' }).click();
  await expect(page.locator('.summary-card').first()).toContainText('$100.00');
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByLabel('Amount in USDC').fill('40');
  await page.getByRole('button', { name: 'Simulate withdraw' }).click();
  await expect(page.locator('.summary-card').first()).toContainText('$60.00');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Explore sale' }).first().click();
  await page.getByRole('button', { name: 'Simulate contribution' }).click();
  await expect(page.getByRole('button', { name: 'Contribution recorded' })).toBeDisabled();
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.locator('.activity-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Rewards', exact: false }).first().click();
  await expect(page.locator('.reward-level')).toContainText('90 XP');
  await page.reload();
  await expect(page.locator('.xp-mini')).toContainText('90 demo XP');
});

test('invalid inputs, modal dismissal, token selection and live gates', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('You pay').fill('-100');
  await expect(page.getByRole('button', { name: 'Enter an amount' })).toBeDisabled();
  await page.getByLabel('You pay').fill('999999');
  await expect(page.getByRole('button', { name: 'Insufficient USDC' })).toBeDisabled();
  await page.getByRole('button', { name: 'Swap settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.token-select').first().click();
  await page.getByLabel('Search tokens').fill('EURC');
  await page.locator('.token-options button').click();
  await expect(page.locator('.token-select').first()).toContainText('EURC');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review live swap' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Approve exact tUSDC' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Connect wallet to transact' })).toBeVisible();
  await expect(page.locator('.notice').first()).toContainText(
    'Lending and borrowing remain unavailable',
  );
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Supply', exact: true })).toBeDisabled();
});

test('mobile navigation and layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Review swap' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Put your assets to work.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
