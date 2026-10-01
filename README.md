# Orbit — a simpler DeFi terminal on Arc

A React + TypeScript terminal with a Sushi/Aave-inspired workflow and a soft, Jumper-inspired purple palette. Responsive desktop/mobile UI, native dialogs, keyboard navigation, and a persistent virtual trading workspace.

## Run

Node 22+, pnpm 11:

```sh
pnpm install
pnpm dev
# Open the URL Vite prints (default http://127.0.0.1:5173)
pnpm build
pnpm preview
```

## What's working

- **Trade:** token picker, pair reversal, input validation, balance/MAX, illustrative quotes, fee/slippage preview, review dialog, simulated settlement.
- **Discover:** example liquidity pools and three fictional launchpad sales; virtual contributions with balance checks.
- **Lend:** virtual USDC supply/withdraw, persistent positions. No fake interest accrual.
- **Portfolio:** virtual asset valuation and local activity history.
- **Rewards:** local XP for swaps (+25), supplies (+15), sale contributions (+50); levels every 500 XP, workspace reset.
- **Wallet:** injected EIP-1193 wallets, account/chain change handling, Arc network add/switch, native USDC balance and explorer links. Demo never requires a wallet.
- **Protocol building blocks:** canonical Uniswap V2-compatible router and Aave V3 Pool adapters using viem, explicit exact approvals, chain checks, simulated execution, quote expiry, minimum-output protection, receipt checks.
- **Launchpad contract:** experimental fixed-price escrow built with OpenZeppelin `SafeERC20`, `Ownable`, `ReentrancyGuard`, and `Math`. Successful-sale claims, failed/cancelled-sale refunds, capped contributions, fully funded inventory, protected unclaimed allocations.

## Important: demo is not production trading

**All prices, charts, TVL, APR/APY, token balances, pools, and projects are illustrative.** Demo trades only update browser storage. XP is editable local progress, not a token, payout, or proof of onchain activity. Sale contributions grant no actual allocation or refund claim.

Live mode is **read-only**. No verified Arc router/lending market/launchpad addresses ship with the app. The transaction adapters are not wired into the UI. Filling environment variables alone does **not** enable transactions. We do not represent an Aave deployment or a Uniswap fork as existing on Arc without verification.

The launchpad is **new, unaudited code using existing OpenZeppelin primitives**, not an audited copied sale contract. Local EVM tests do not establish safety for real funds. Do not deploy with real money without independent review.

### Arc configuration

Source: [official Arc connection reference](https://docs.arc.io/arc/references/connect-to-arc).

| Setting          | Arc testnet                       |
| ---------------- | --------------------------------- |
| Chain ID         | `5042002`                         |
| RPC              | `https://rpc.testnet.arc.io`      |
| Explorer         | `https://explorer.testnet.arc.io` |
| Native gas token | USDC, **18 decimals**             |

**ERC-20 USDC and native gas USDC are not interchangeable.** Verify each ERC-20 address and its `decimals()`; the demo USDC uses 6 decimals. ETH/BTC demo symbols do not imply canonical bridged Arc assets.

Copy `.env.example` to `.env.local` only after deployment verification. Client-side variables are public; never put private keys in `VITE_*` variables.

## Tests

```sh
pnpm test                  # amount/slippage tests + launchpad local-EVM tests
pnpm contracts:check       # compile launchpad with pinned-lockfile solc/OZ
pnpm exec playwright install chromium
pnpm test:e2e              # full flows, invalid inputs, live gates, mobile layout
# Or use an installed system browser:
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
```

Ganache may report a missing native µWS binary on Node 22; it falls back to JavaScript. This does not prevent the tests from running. Compile artifacts are generated under `contracts/artifacts/` (gitignored).

## Structure

```text
src/App.tsx                       Terminal screens and demo workflows
src/styles.css                    Responsive visual system
src/lib/market.ts                  Demo fixtures, amount/slippage utilities, storage
src/lib/arc.ts                     Arc chain and deployment checks
src/lib/useWallet.ts               Injected wallet lifecycle
src/lib/protocols.ts               Canonical router/Aave adapters (not UI-connected)
contracts/src/FixedPriceLaunchpad.sol
contracts/launchpad.test.js        Local EVM escrow integration tests
scripts/check-contracts.mjs        Solidity compilation
 e2e/terminal.spec.ts              Browser acceptance tests
```

## Next production milestone

See [deployment checklist](docs/DEPLOYMENT.md). Work outstanding: verified live deployments/token allowlist, actual liquidity and route discovery, live market/indexer data, transaction UI with approval/receipt lifecycle, lending risk/health-factor UI, audited sale deployments, and receipt-verified server-side XP. A production lending market needs oracles, governance, reserves and liquidation infrastructure—not just a copied pool contract.

Upstream protocols: [Uniswap V2 Router](https://github.com/Uniswap/v2-periphery), [Aave V3](https://github.com/aave/aave-v3-core), [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-contracts). Dependencies are reused as packages; upstream license notices remain intact.
