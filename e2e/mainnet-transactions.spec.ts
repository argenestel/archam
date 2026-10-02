import { expect, test } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, multicall3Abi } from 'viem';
// Entirely mocked RPC/SDK/wallet; never broadcasts to a live network.
async function setup(page: import('@playwright/test').Page, rejected: boolean | 'unknown') {
  await page.route('**/src/lib/appkit.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    export const kitChain = 'Arc'; export const signingEnabled = true;
    export const adapterFor = async provider => provider;
    export const getKit = async () => ({
      estimateSwap: async () => ({ estimatedOutput: { amount: '0.08' }, stopLimit: { amount: '0.0796' }, fees: [] }),
      swap: async ({from}) => {
        await from.adapter.request({ method: 'wallet_sendCalls', params: [] });
        return { status: 'submitted', batchId: 'batch-fixture' };
      }
    });
    export const useVaultCatalog = () => ({ data: [], loading: false });
    export const verifyVault = async () => {};
  `,
    }),
  );
  const value = `0x${100_000_000n.toString(16).padStart(64, '0')}`;
  await page.route('**/api/arc-rpc-mainnet*', async (route) => {
    const body = route.request().postDataJSON();
    const response = (request: {
      id: number;
      method: string;
      params?: { to?: string; data?: `0x${string}` }[];
    }) => {
      let result: unknown = '0x0';
      if (request.method === 'eth_chainId') result = '0x13b2';
      if (request.method === 'eth_getBalance') result = `0x${(100n * 10n ** 18n).toString(16)}`;
      if (request.method === 'eth_call') {
        result =
          request.params?.[0]?.to?.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11'
            ? encodeFunctionResult({
                abi: multicall3Abi,
                functionName: 'aggregate3',
                result: (
                  decodeFunctionData({ abi: multicall3Abi, data: request.params![0].data! })
                    .args![0] as readonly { target: string }[]
                ).map((call) => ({
                  success: true,
                  returnData: (call.target.toLowerCase() ===
                  '0xca11bde05977b3631167028862be2a173976ca11'
                    ? `0x${(100n * 10n ** 18n).toString(16).padStart(64, '0')}`
                    : value) as `0x${string}`,
                })),
              })
            : value;
      }
      return { jsonrpc: '2.0', id: request.id, result };
    };
    await route.fulfill({ json: Array.isArray(body) ? body.map(response) : response(body) });
  });
  await page.addInitScript(
    ({ rejected }) => {
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method.endsWith('ccounts')) return ['0x000000000000000000000000000000000000beef'];
          if (method === 'eth_chainId') return '0x13b2';
          if (method === 'wallet_sendCalls') {
            if (rejected)
              throw Object.assign(new Error('Fixture submission failed'), {
                code: rejected === 'unknown' ? -32000 : 4001,
              });
            return { id: 'batch-fixture' };
          }
          if (method === 'wallet_getCallsStatus') return { status: 100 };
          throw new Error('Unexpected fixture request: ' + method);
        },
        on() {},
        removeListener() {},
      };
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: {
              info: { rdns: 'test.batch', name: 'Batch Fixture', uuid: 'batch', icon: '' },
              provider,
            },
          }),
        ),
      );
    },
    { rejected },
  );
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Batch Fixture', exact: true }).click();
  // These tests cover the Circle (App Kit) flow, now a tab beside the default "Best price" router.
  await page.getByRole('button', { name: 'USDC and EURC', exact: true }).click();
  await page.getByLabel('You pay').fill('0.1');
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm swap', exact: true }).click();
}
test('submitted SDK batch is persisted, never reported as confirmed, and blocks duplicates after reload', async ({
  page,
}) => {
  await setup(page, false);
  await expect(
    page.getByText('Previous transaction unresolved. Do not submit it again.', { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit.external.pending.v1') || '{}').batchId,
    ),
  ).toBe('batch-fixture');
  await expect(page.getByText('Receipt confirmed on Arc', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('main .btn-block')).toHaveText('Resolve previous transaction');
  await page.getByRole('button', { name: 'Check wallet batch' }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit.external.pending.v1') || '{}').batchId,
    ),
  ).toBe('batch-fixture');
});
test('provider failure without an identifier preserves an unknown-submission lock', async ({
  page,
}) => {
  await setup(page, 'unknown');
  await expect(
    page.getByText('Previous transaction unresolved. Do not submit it again.', { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit.external.pending.v1') || '{}').batchId,
    ),
  ).toBe('unidentified-submission');
  await expect(page.getByText('Receipt confirmed on Arc', { exact: true })).toHaveCount(0);
});

test('explicit wallet rejection does not leave a submitted-batch lock', async ({ page }) => {
  await setup(page, true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('orbit.external.pending.v1'))).toBeNull();
  await expect(page.getByText('Receipt confirmed on Arc', { exact: true })).toHaveCount(0);
});
