import { defineConfig } from '@playwright/test';
const mainnet = process.env.ORBIT_MAINNET_E2E === '1';
const preview = process.env.ORBIT_PREVIEW_E2E === '1';
const port = Number(process.env.ORBIT_E2E_PORT ?? (mainnet ? 5193 : 5173));
export default defineConfig({
  testDir: './e2e',
  testMatch: mainnet ? ['**/mainnet*.spec.ts', '**/migration.spec.ts'] : '**/*.spec.ts',
  testIgnore: mainnet ? [] : ['**/mainnet*.spec.ts'],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  },
  webServer: {
    command: preview
      ? `node scripts/preview.mjs --dir ${mainnet ? 'out-mainnet' : 'out'} --host 127.0.0.1 --port ${port}`
      : `${mainnet ? 'pnpm dev:mainnet' : 'pnpm dev'} --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
