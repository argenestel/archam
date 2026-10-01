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

## UI and connectivity

The live workspace defaults to a two-pane swap/pool view with real reserve reads, self-hosted fonts, and mobile layout. See [design direction](docs/DESIGN.md).

Browser RPC reads use same-origin proxy routes with official QuickNode/dRPC backups, friendly errors, and retry/recovery controls. See [RPC troubleshooting and hosting requirements](docs/RPC.md). Vite development/preview and the Nginx package include the routes; static-only hosts must configure equivalent proxies.

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

**Demo prices, charts, TVL, APR/APY, balances, pools, and projects are illustrative.** Demo trades only update browser storage. XP is editable local progress, not a token, payout, or proof of onchain activity. Demo sale contributions grant no actual allocation or refund claim.

**Live mode now supports Arc testnet swaps and a deployed test sale.** The canonical Uniswap V2 factory/router artifacts are deployed, a tUSDC/tETH pool is seeded, and the experimental launchpad has full inventory. Connect a wallet on Arc testnet, claim valueless faucet assets, approve the exact payment, then review and sign. The UI checks runtime bytecode hashes against the committed deployment manifest. This is integrity checking, not an audit or explorer source verification.

**tUSDC is not Circle USDC; tETH is not real ETH.** Both are freely minted test assets with no financial value. Only native testnet USDC pays gas. The legacy WETH9 wrapper required by Router02 wraps native USDC on Arc; native-token swaps and that wrapper are intentionally not exposed in the UI. No verified Aave lending market is enabled. Live portfolio/indexer data and server-verified XP remain outstanding.

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

The live testnet allowlist is `deployments/arc-testnet.json`; changing environment variables does not change the UI's approved contracts. Client-side variables are public; never put private keys in `VITE_*` variables.

## Deployed testnet stack

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| Uniswap V2 Router02     | `0xa1ae04767893d81bed19272fee30746132e339de` |
| Uniswap V2 Factory      | `0x9c074d5f07ab2ad10bb00dfecbf22c14cd1de611` |
| Launchpad               | `0x3fed4122a1a924dcd0fd7ede9afd2dbba964b0c1` |
| Test tUSDC (6 decimals) | `0x995ac9f68d8fb92d240064692fa63af7cc02663c` |
| Test tETH (18 decimals) | `0x461124bf2a8677df03b9f7560060d81442551124` |

Deployment and actual swap/contribution smoke-test receipts are committed in `deployments/arc-testnet.json`. Wallet secrets are **not**. See [testnet operations](docs/TESTNET.md) for wallet, deployment, and hosting commands.

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
src/lib/protocols.ts               Canonical router/Aave adapters
src/LiveTerminal.tsx               Live testnet faucet, swap, and sale transaction UI
src/lib/deployed.ts                Manifest allowlist and runtime integrity checks
contracts/src/FixedPriceLaunchpad.sol
contracts/launchpad.test.js        Local EVM escrow integration tests
scripts/check-contracts.mjs        Solidity compilation
 e2e/terminal.spec.ts              Browser acceptance tests
```

## Next production milestone

See [deployment checklist](docs/DEPLOYMENT.md). Work outstanding: independent security review/source verification, real-asset integrations and route discovery, live market/indexer data, transaction replacement/finality hardening, lending risk/health-factor UI, audited sale deployments, and receipt-verified server-side XP. A production lending market needs oracles, governance, reserves and liquidation infrastructure—not just a copied pool contract.

Upstream protocols: [Uniswap V2 Router](https://github.com/Uniswap/v2-periphery), [Aave V3](https://github.com/aave/aave-v3-core), [OpenZeppelin](https://github.com/OpenZeppelin/openzeppelin-contracts). Dependencies are reused as packages; upstream license notices remain intact.
