import { test, expect, type Page } from '@playwright/test';
import { decodeFunctionData, erc20Abi } from 'viem';
import { mockRpc, type RpcState } from './support/rpc';
import manifest from '../deployments/arc-testnet.json' with { type: 'json' };
const hash = `0x${'3'.repeat(64)}`;
async function wallet(page: Page, reject = false) {
  await page.addInitScript(
    ({ reject, hash }) => {
      const calls: { method: string; params?: unknown[] }[] = [];
      const target = window as unknown as { ethereum: unknown; walletCalls: typeof calls };
      target.walletCalls = calls;
      target.ethereum = {
        on() {},
        removeListener() {},
        async request(request: { method: string; params?: unknown[] }) {
          calls.push(request);
          if (request.method === 'eth_chainId') return '0x4cef52';
          if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts')
            return [`0x${'2'.repeat(40)}`];
          if (
            request.method === 'eth_sendTransaction' ||
            request.method === 'wallet_sendTransaction'
          ) {
            if (reject) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
            return hash;
          }
          throw new Error('Unexpected wallet method ' + request.method);
        },
      };
    },
    { reject, hash },
  );
}
const submissions = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        walletCalls: {
          method: string;
          params: { to?: string; data?: `0x${string}`; from?: string }[];
        }[];
      }
    ).walletCalls.filter((call) =>
      /^(eth_sendTransaction|wallet_sendTransaction)$/.test(call.method),
    ),
  );
test('approval is user-triggered, exact, and does not automatically send a swap', async ({
  page,
}) => {
  await wallet(page);
  const state: RpcState = {};
  await page.route('**/api/arc-rpc*', (route) => {
    if (route.request().postDataJSON().method === 'eth_getTransactionReceipt')
      state.allowance = 100000000n;
    return mockRpc(route, state);
  });
  await page.goto('/');
  await page.getByLabel('Sell', { exact: true }).fill('100');
  await expect(page.getByRole('button', { name: 'Approve tUSDC', exact: true })).toBeEnabled();
  expect(await submissions(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Approve tUSDC', exact: true }).click();
  await expect(page.getByRole('link', { name: 'View transaction', exact: true })).toHaveAttribute(
    'href',
    new RegExp(hash),
  );
  await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
  const requests = await submissions(page);
  expect(requests).toHaveLength(1);
  const tx = requests[0].params[0];
  expect(tx.to?.toLowerCase()).toBe(manifest.contracts.TestUSDC.address.toLowerCase());
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
  expect(decoded.functionName).toBe('approve');
  expect((decoded.args![0] as string).toLowerCase()).toBe(
    manifest.contracts.UniswapV2Router02.address.toLowerCase(),
  );
  expect(decoded.args![1]).toBe(100000000n);
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Receive at least');
  expect(await submissions(page)).toHaveLength(1);
});
test('unknown confirmation retains its hash across reload and blocks resubmission', async ({
  page,
}) => {
  await wallet(page);
  const state: RpcState = { receipt: 'unavailable' };
  await page.route('**/api/arc-rpc*', (route) => mockRpc(route, state));
  await page.goto('/');
  await page.getByLabel('Sell', { exact: true }).fill('100');
  await expect(page.getByRole('button', { name: 'Approve tUSDC', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve tUSDC', exact: true }).click();
  await expect(
    page.getByText('Transaction submitted. Waiting for confirmation.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View transaction', exact: true })).toHaveAttribute(
    'href',
    new RegExp(hash),
  );
  expect(await submissions(page)).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Check transaction status', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve tUSDC', exact: true })).toHaveCount(0);
  expect(await submissions(page)).toHaveLength(0);
  state.receipt = 'success';
  state.allowance = 100000000n;
  await page.getByRole('button', { name: 'Check transaction status', exact: true }).click();
  await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
  expect(await submissions(page)).toHaveLength(0);
});
test('wallet rejection does not write a pending transaction', async ({ page }) => {
  await wallet(page, true);
  await page.route('**/api/arc-rpc*', (route) => mockRpc(route));
  await page.goto('/');
  await page.getByLabel('Sell', { exact: true }).fill('100');
  await expect(page.getByRole('button', { name: 'Approve tUSDC', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve tUSDC', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Request cancelled');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('orbit.testnet.transactions.v1') || '[]'),
    ),
  ).toEqual([]);
});
test('a post-confirmation balance outage does not turn success into an unknown transaction', async ({
  page,
}) => {
  await wallet(page);
  const state: RpcState = {};
  let confirmed = false;
  await page.route('**/api/arc-rpc*', (route) => {
    const body = route.request().postDataJSON();
    if (body.method === 'eth_getTransactionReceipt') {
      confirmed = true;
      state.allowance = 100000000n;
    }
    if (confirmed && body.method === 'eth_call' && body.params[0].data.startsWith('0x70a08231'))
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32000, message: 'Gateway unavailable' },
        },
      });
    return mockRpc(route, state);
  });
  await page.goto('/');
  await page.getByLabel('Sell', { exact: true }).fill('100');
  await expect(page.getByRole('button', { name: 'Approve tUSDC', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve tUSDC', exact: true }).click();
  await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Arc is unavailable. Trading is paused.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Confirmation unavailable', { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit.testnet.transactions.v1') || '[]')[0].status,
    ),
  ).toBe('confirmed');
});

test('visiting demo does not leak its dashboard styles into live mode', async ({ page }) => {
  await page.route('**/api/arc-rpc*', (route) => mockRpc(route));
  await page.goto('/');
  const before = await page.locator('.exchange-card').evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    radius: getComputedStyle(el).borderRadius,
  }));
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next move starts here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  const after = await page.locator('.exchange-card').evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    radius: getComputedStyle(el).borderRadius,
  }));
  expect(after).toEqual(before);
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
