import { defineConfig } from '@playwright/test';
const mainnet = process.env.ORBIT_MAINNET_E2E === '1';
const port = mainnet ? 5193 : 5173;
export default defineConfig({
  testDir: './e2e',
  testMatch: mainnet ? '**/mainnet*.spec.ts' : '**/*.spec.ts',
  testIgnore: mainnet ? [] : ['**/mainnet*.spec.ts'],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  },
  webServer: {
    command: `${mainnet ? 'pnpm dev:mainnet' : 'pnpm dev'} --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
