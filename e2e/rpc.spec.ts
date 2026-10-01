import { test, expect, type Route } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import codes from './fixtures/runtime-code.json' with { type: 'json' };
import manifest from '../deployments/arc-testnet.json' with { type: 'json' };
const abi = parseAbi([
  'function totalRaised() view returns (uint256)',
  'function successful() view returns (bool)',
  'function cancelled() view returns (bool)',
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
]);
async function mockRpc(route: Route) {
  const body = route.request().postDataJSON();
  let result: unknown;
  switch (body.method) {
    case 'eth_chainId':
      result = '0x4cef52';
      break;
    case 'eth_getCode':
      result = codes[body.params[0].toLowerCase() as keyof typeof codes] || '0x';
      break;
    case 'eth_blockNumber':
      result = '0x3df0000';
      break;
    case 'eth_getBlockByNumber':
      result = {
        number: '0x3df0000',
        timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
        hash: `0x${'1'.repeat(64)}`,
        parentHash: `0x${'0'.repeat(64)}`,
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        size: '0x1',
        difficulty: '0x0',
        transactions: [],
        uncles: [],
        extraData: '0x',
      };
      break;
    case 'eth_call': {
      const call = decodeFunctionData({ abi, data: body.params[0].data });
      if (call.functionName === 'getAmountsOut') {
        const amount = call.args![0] as bigint;
        result = encodeFunctionResult({
          abi,
          functionName: 'getAmountsOut',
          result: [amount, (amount * 100n * 10n ** 18n * 997n) / (268432n * 10n ** 6n * 1000n)],
        });
      } else if (call.functionName === 'getReserves')
        result = encodeFunctionResult({
          abi,
          functionName: 'getReserves',
          result: [268432000000n, 100n * 10n ** 18n, 0],
        });
      else if (call.functionName === 'token0')
        result = encodeFunctionResult({
          abi,
          functionName: 'token0',
          result: manifest.contracts.TestUSDC.address as `0x${string}`,
        });
      else if (call.functionName === 'totalRaised')
        result = encodeFunctionResult({ abi, functionName: 'totalRaised', result: 10000000n });
      else result = encodeFunctionResult({ abi, functionName: call.functionName, result: false });
      break;
    }
    default:
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Unexpected mocked RPC method' },
        },
      });
  }
  return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
}
test('failed primary RPC falls back without leaking raw errors', async ({ page }) => {
  let fallbackRequests = 0;
  await page.route('**/api/arc-rpc*', (route) => {
    if (new URL(route.request().url()).pathname === '/api/arc-rpc') return route.abort('failed');
    fallbackRequests++;
    return mockRpc(route);
  });
  await page.goto('/');
  await expect(page.getByText('Arc connected', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Review live swap' })).toBeDisabled();
  offline = false;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByText('Arc connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('live workspace fits mobile without horizontal overflow', async ({ page }) => {
  await page.route('**/api/arc-rpc*', mockRpc);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Arc connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inside the pool' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
