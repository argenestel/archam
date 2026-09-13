import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
 const page = await browser.newPage();
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto(process.env.UI_URL || 'http://localhost:3000');
 const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true });
 for (const width of [390, 768, 1440]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const tab of ['Explore','Launch','Trade','Portfolio','Swap','Bridge','Privacy']) {
   await nav(tab).click();
   await expect(page.locator('main')).toBeVisible();
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tab).toBe(true);
   await page.screenshot({ path: '/tmp/mofu-neutral-' + tab + '-' + width + '.png', fullPage: true });
 }
 await nav('Launch').click();
  await page.getByLabel('Swap route', { exact: true }).selectOption('coins');
  await page.getByRole('button', { name: '+ Launch a Coin', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Coin Name', { exact: true }).fill('Modal test');
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/mofu-neutral-launch-modal-' + width + '.png' });
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name:'Market Config', exact:true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await nav('Trade').click();
  await page.getByRole('button', { name:'Book Config', exact:true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await nav('Privacy').click();
  await expect(page.getByRole('heading', { name:'Preview only', exact:true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 expect(errors).toEqual([]);
 console.log('PASS: seven routes, three widths, launch/settings dialogs, privacy draft download and swap preview.');
} finally { await browser.close(); }
