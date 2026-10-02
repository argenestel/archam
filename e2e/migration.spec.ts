import { expect, test, type Page } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi, type Hex } from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Playwright imports the same CSP helper used by Docker.
import { collectInlineScriptHashes, renderNginxConfig } from '../scripts/build-csp.mjs';

const TOKEN = '0x00000000000000000000000000000000000000aa' as const;
const CREATOR = '0x000000000000000000000000000000000000beef' as const;
const ZERO = '0x0000000000000000000000000000000000000000' as const;
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
const mainnet = process.env.ORBIT_MAINNET_E2E === '1';
const expectedNetwork = mainnet ? 'Arc Mainnet' : 'Arc Testnet';
const arcChainId = mainnet ? '0x13b2' : '0x4cef52';
const PROFILE = {
  address: CREATOR,
  name: 'Arc Alice',
  bio: 'Trading on Arc',
  avatar: '',
  website: 'https://example.com',
  uri: 'ipfs://bafyMigrationProfile',
};

const fixtureAbi = parseAbi([
  'function curves(address) view returns (address creator, uint40 createdAt, uint40 lastTradeAt, bool graduated, uint256 virtualQuote, uint256 virtualToken, uint256 realQuote, uint256 tokensLeft, uint256 volume, uint32 trades, address pair, string image, string description)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

type RpcRequest = {
  id?: number | string | null;
  method?: string;
  params?: unknown[];
};

const rpcError = (request: RpcRequest) => ({
  jsonrpc: '2.0',
  id: request.id ?? null,
  error: {
    code: -32042,
    message: 'Deterministic migration fixture: read unavailable',
  },
});

function encodeFixtureCall(data: Hex): Hex | undefined {
  try {
    const decoded = decodeFunctionData({ abi: fixtureAbi, data });
    if (decoded.functionName === 'name')
      return encodeFunctionResult({
        abi: fixtureAbi,
        functionName: 'name',
        result: 'Fixture Token',
      });
    if (decoded.functionName === 'symbol')
      return encodeFunctionResult({
        abi: fixtureAbi,
        functionName: 'symbol',
        result: 'FIX',
      });
    if (decoded.functionName === 'curves')
      return encodeFunctionResult({
        abi: fixtureAbi,
        functionName: 'curves',
        result: [
          CREATOR,
          1_700_000_000,
          1_700_000_100,
          false,
          1_000_000n,
          1_000_000_000_000_000_000n,
          500_000n,
          700_000_000_000_000_000_000_000_000n,
          2_500_000n,
          3,
          ZERO,
          '',
          'A deterministic token fixture for migration coverage.',
        ],
      });
  } catch {
    // Unsupported calls intentionally fall through to a JSON-RPC error below.
  }
  return undefined;
}

function rpcResponse(request: RpcRequest, tokenFixture: boolean) {
  if (tokenFixture && request.method === 'eth_call') {
    const call = request.params?.[0] as { to?: string; data?: Hex } | undefined;
    if (call?.to?.toLowerCase() === MULTICALL3 && call.data) {
      try {
        const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
        if (decoded.functionName === 'aggregate3') {
          const results = (decoded.args?.[0] as readonly { target: string; callData: Hex }[]).map(
            ({ callData }) => {
              const returnData = encodeFixtureCall(callData);
              return {
                success: !!returnData,
                returnData: returnData ?? '0x',
              };
            },
          );
          return {
            jsonrpc: '2.0',
            id: request.id ?? null,
            result: encodeFunctionResult({
              abi: multicall3Abi,
              functionName: 'aggregate3',
              result: results,
            }),
          };
        }
      } catch {
        // Keep the same stable error shape for malformed or unsupported calls.
      }
    }
  }
  return rpcError(request);
}

async function installRpc(page: Page, tokenFixture = false) {
  await page.route('**/api/arc-rpc*', async (route) => {
    const raw = route.request().postData() || '{}';
    let payload: RpcRequest | RpcRequest[];
    try {
      payload = JSON.parse(raw) as RpcRequest | RpcRequest[];
    } catch {
      payload = {};
    }
    const response = Array.isArray(payload)
      ? payload.map((request) => rpcResponse(request, tokenFixture))
      : rpcResponse(payload, tokenFixture);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

async function installMediaFixture(page: Page) {
  await page.route('**/api/media/profiles/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PROFILE),
    }),
  );
  // Borrow and vault views use a provider SDK in some builds. Return a local failure if they
  // attempt discovery so route coverage never depends on an external service.
  await page.route('**/api.circle.com/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Deterministic migration fixture: provider unavailable' }),
    }),
  );
}

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  await installRpc(page);
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await installMediaFixture(page);
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test('preserves hash navigation through browser history and reload', async ({ page }) => {
  await page.goto('/#/risks');
  await expect(page.getByRole('heading', { name: 'Risks', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Swap', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/swap$/);
  await expect(page.getByRole('heading', { name: 'Swap', exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/risks$/);
  await expect(page.getByRole('heading', { name: 'Risks', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/#\/swap$/);
  await expect(page.getByRole('heading', { name: 'Swap', exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/#\/swap$/);
  await expect(page.getByRole('heading', { name: 'Swap', exact: true })).toBeVisible();
});

test('prefills the buy amount when a token hash route is opened directly', async ({ page }) => {
  await installRpc(page, true);
  await page.goto(`/#/token/${TOKEN}?buy=12.34`);
  await expect(page.getByRole('heading', { name: /Fixture Token/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveURL(new RegExp(`#\\/token\\/${TOKEN}\\?buy=12\\.34$`));
  await expect(page.getByLabel('You pay')).toHaveValue('12.34');
});

test('renders a public profile from its hash route and media fixture', async ({ page }) => {
  await page.goto(`/#/profile/${CREATOR}`);
  await expect(page.getByRole('heading', { name: 'Trader profile', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Arc Alice', exact: true })).toBeVisible();
  await expect(page.getByText('Trading on Arc', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View profile metadata on IPFS' })).toHaveAttribute(
    'href',
    'https://gateway.pinata.cloud/ipfs/bafyMigrationProfile',
  );
});

test('shows the disconnected personal profile guard', async ({ page }) => {
  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
});

test('connects a discovered wallet and displays its account', async ({ page }) => {
  const account = '0x000000000000000000000000000000000000cafe';
  await page.addInitScript(
    ({ account, chainId }) => {
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
          if (method === 'eth_chainId') return chainId;
          return null;
        },
        on() {},
        removeListener() {},
      };
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: {
              info: {
                rdns: 'migration.fixture',
                name: 'Migration Wallet',
                uuid: 'migration',
                icon: '',
              },
              provider,
            },
          }),
        ),
      );
    },
    { account, chainId: arcChainId },
  );
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Migration Wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: `Wallet ${account}`, exact: true })).toBeVisible();
});

test('shows the Arc network guard for a wallet connected to another chain', async ({ page }) => {
  const account = '0x000000000000000000000000000000000000cafe';
  await page.addInitScript(
    ({ account }) => {
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
          if (method === 'eth_chainId') return '0x1';
          return null;
        },
        on() {},
        removeListener() {},
      };
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: {
              info: {
                rdns: 'migration.wrong-network',
                name: 'Wrong Network Wallet',
                uuid: 'wrong-network',
                icon: '',
              },
              provider,
            },
          }),
        ),
      );
    },
    { account },
  );
  await page.goto('/#/swap');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Wrong Network Wallet', exact: true }).click();
  await expect(page.locator('main .btn-block').first()).toHaveText('Switch to Arc');
  await expect(
    page.getByRole('button', { name: 'Switch to Arc', exact: true }).first(),
  ).toBeVisible();
});

test('serves migration metadata and loads the bundled IBM Plex fonts', async ({ page }) => {
  await page.goto('/#/risks');
  await expect(page).toHaveTitle('Mofu · Launch, trade & lend on Arc');
  await expect(page.locator('.net-pill')).toHaveText(expectedNetwork);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Mofu.*launch.*trade.*lend.*Arc/i,
  );
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 15px "IBM Plex Sans"'),
      document.fonts.load('600 32px "IBM Plex Sans Condensed"'),
    ]);
    return {
      sans: document.fonts.check('400 15px "IBM Plex Sans"'),
      condensed: document.fonts.check('600 32px "IBM Plex Sans Condensed"'),
    };
  });
  expect(fonts).toEqual({ sans: true, condensed: true });
});

test('keeps existing routes free of horizontal overflow at mobile and desktop widths', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const routes = [
    '',
    'swap',
    'lend',
    'borrow',
    'leaders',
    'portfolio',
    'create',
    'risks',
    'bridge',
  ];
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route ? `/#/${route}` : '/');
      await expect(page.locator('main :is(h1, h2, h3)').first()).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
          message: `${route || 'discover'} at ${width}px`,
          timeout: 5_000,
        })
        .toBeLessThanOrEqual(0);
    }
  }
});

test('serves the static export with its generated CSP without policy violations', async ({
  page,
}) => {
  test.skip(process.env.ORBIT_PREVIEW_E2E !== '1', 'CSP verification targets the static export');
  const outputDir = resolve(mainnet ? 'out-mainnet' : 'out');
  const template = readFileSync(resolve('deploy/nginx.conf'), 'utf8');
  const hashes = collectInlineScriptHashes(outputDir);
  const rendered = renderNginxConfig(template, hashes);
  const policy = rendered.match(/Content-Security-Policy "([^"]+)"/)?.[1];
  expect(policy).toBeTruthy();
  for (const hash of hashes) expect(policy).toContain(hash);

  await page.addInitScript(() => {
    (window as unknown as Window & { __cspViolations?: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as Window & { __cspViolations: string[] }).__cspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI}`,
      );
    });
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': policy! },
    });
  });

  await page.goto('/#/risks');
  await expect(page.getByRole('heading', { name: 'Risks', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('main :is(h1, h3)').first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Window & { __cspViolations?: string[] }).__cspViolations ?? [],
      ),
    )
    .toEqual([]);
});
