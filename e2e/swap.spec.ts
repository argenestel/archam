import { test, expect } from '@playwright/test';
import { decodeFunctionData, parseAbi } from 'viem';
import { mockRpc } from './support/rpc';
import manifest from '../deployments/arc-testnet.json' with { type: 'json' };
test('swap requires review and submits guarded calldata to the allowlisted router', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: { method: string; params?: unknown[] }[] = [];
    Object.assign(window, {
      swapWalletCalls: calls,
      ethereum: {
        on() {},
        removeListener() {},
        async request(request: { method: string; params?: unknown[] }) {
          calls.push(request);
          if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts')
            return [`0x${'2'.repeat(40)}`];
          if (request.method === 'eth_chainId') return '0x4cef52';
          if (request.method === 'eth_sendTransaction') return `0x${'4'.repeat(64)}`;
          throw new Error('Unexpected wallet method ' + request.method);
        },
      },
    });
  });
  await page.route('**/api/arc-rpc*', (route) =>
    mockRpc(route, {
      allowance: 100000000n,
      receiptTo: manifest.contracts.UniswapV2Router02.address,
    }),
  );
  await page.goto('/');
  await page.getByLabel('Sell', { exact: true }).fill('100');
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Receive at least');
  expect(
    await page.evaluate(() =>
      (window as unknown as { swapWalletCalls: { method: string }[] }).swapWalletCalls.filter(
        (c) => c.method === 'eth_sendTransaction',
      ),
    ),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm swap on Arc testnet', exact: true }).click();
  await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() =>
    (
      window as unknown as {
        swapWalletCalls: { method: string; params: { to: string; data: `0x${string}` }[] }[];
      }
    ).swapWalletCalls.filter((c) => c.method === 'eth_sendTransaction'),
  );
  expect(requests).toHaveLength(1);
  const tx = requests[0].params[0];
  expect(tx.to.toLowerCase()).toBe(manifest.contracts.UniswapV2Router02.address.toLowerCase());
  const decoded = decodeFunctionData({
    abi: parseAbi([
      'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
    ]),
    data: tx.data,
  });
  const args = decoded.args!;
  expect(args[0]).toBe(100000000n);
  const quote = (100000000n * 100n * 10n ** 18n * 997n) / (268432n * 10n ** 6n * 1000n);
  expect(args[1]).toBe((quote * 9950n) / 10000n);
  expect((args[2] as string[]).map((a) => a.toLowerCase())).toEqual([
    manifest.contracts.TestUSDC.address,
    manifest.contracts.TestETH.address,
  ]);
  expect((args[3] as string).toLowerCase()).toBe(`0x${'2'.repeat(40)}`);
  expect(args[4]).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
});
