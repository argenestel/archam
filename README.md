# Mofu — launch, trade and lend on Arc

Public brand: **Mofu** (formerly Orbit). Intended domain: **https://mofu.lol**. Domain/DNS/TLS hosting is not provisioned by the local build. Legacy contract artifact names, storage keys, and deployment records remain compatible.

**Release status:** testnet beta, plus an opt-in mainnet protocol hub (Circle-routed swaps, Morpho vaults, cirBTC loans: [setup and limits](docs/MAINNET_APP.md)). **Mofu's launch contract is live on Arc mainnet in hackathon mode**: unaudited, single-wallet owner, launches enabled, at `0xB583aD345d9261F267D6966f2D965C40E25e5cb4` ([details and known gaps](docs/MAINNET_PLAN.md#hackathon-deployment-live)). Not production-certified; production gates (audit, Safe, legal) are in [release gates](docs/RELEASE.md).
**Start every update with [the project reference](docs/PROJECT_REFERENCE.md).**

Mofu is a FOMO-style trading app for [Arc](https://arc.io), Circle's stablecoin-native L1:

- **Discover (launches):** anyone launches a fixed-supply token in one transaction. It trades against **real Arc USDC** on a virtual-reserve bonding curve. At ~57 USDC raised (testnet), the curve **graduates**: its USDC and reserved tokens are minted into a Uniswap V2 pool and the LP is burned. Includes the featured launch, live trade ticker/feed, per-token chart, trades and positions.
- **Social:** follow traders (private browser watchlist), "Following" feed, in-app alerts when a followed wallet trades, one-tap **copy trade**.
- **Leaderboard & points:** P&L (marked to market) and volume-based points, recomputed from on-chain launch-contract state. Points have no monetary value and can't be farmed for free.
- **Swap:** USDC↔EURC through Circle App Kit (mainnet + testnet), plus Mofu's Uniswap V2 pools on testnet.
- **Lend:** curated Morpho **Earn vaults** through Circle App Kit, plus a canonical Morpho Blue test market (tETH → tUSDC) with health factor and the full borrow cycle.
- **Fund-manager agent:** an MCP server that Claude Code or Codex drives to read market data and swap, lend and rebalance within a policy you set. See [docs/AGENT.md](docs/AGENT.md).
- **Portfolio:** balances, launch positions with P&L, lending position, points level, local transaction history.

## Run

```sh
pnpm install
pnpm dev            # Next.js development server at http://localhost:5191
pnpm build          # static export in out/
pnpm preview        # static export preview at http://localhost:4173
```

The Docker/Nginx image is the production-like server and also provides the RPC and media proxies.

`pnpm dev:mainnet` starts the opt-in mainnet protocol hub at **http://localhost:5193**; `pnpm build:mainnet` writes `out-mainnet/`. Use your own wallet; never send funds directly to Mofu or router addresses. See [mainnet beta documentation](docs/MAINNET_APP.md) before funding.

`VITE_ARC_NETWORK=mainnet VITE_MAINNET_SIGNING=0 pnpm exec next build` produces a read-only mainnet static export (chain 5042). The Next configuration intentionally reads the existing `VITE_*` build flags, so local `.env` files remain compatible. It enables only features with a recorded mainnet deployment, so today every Mofu-operated feature shows a "not live on this network" state instead of pointing at testnet contracts.

## Logos and profiles

Launches use a responsive card grid. Optional token logos and wallet-authorized public profiles are pinned to Pinata/IPFS. Set server-only `PINATA_JWT` in `.env`, run `pnpm media` alongside the Next.js dev server, or deploy with `docker compose up --build -d`. See [IPFS setup and storage limitations](docs/IPFS.md). Never put Pinata secrets in `VITE_*` variables.

## Contracts

| Contract | Source | Notes |
| --- | --- | --- |
| `MofuLaunch` / `MofuToken` | `contracts/src/` (new, **unaudited**) | Bonding curve, on-chain trade feed and trader stats, grief-resistant graduation |
| Morpho Blue + AdaptiveCurveIrm | `contracts/vendor/` (upstream, unmodified, pinned commits) | Built with upstream settings (solc 0.8.19, via-IR) |
| `MofuTestnetOracle` | `contracts/src/` | Owner-posted **testnet-only** price with staleness guard |

Contract names now use Mofu; existing on-chain Orbit deployments and historical manifest keys remain unchanged. See [the internal contract security review](docs/CONTRACT_AUDIT.md) for findings and limitations.
| Uniswap V2 factory/router | npm canonical artifacts | Project-deployed on testnet |

Addresses, constructor args, receipts and runtime hashes are in `deployments/arc-testnet.json`. The UI refuses to sign if a manifest contract's runtime bytecode differs.

## Validate

```sh
pnpm contracts:check           # compile everything
pnpm test                      # unit + local-EVM contract tests (curve, graduation grief, Morpho flow)
forge test                     # Foundry invariants + fuzz (needs contracts/lib/forge-std)
node agent/policy.test.mjs     # fund-manager policy engine
pnpm test:e2e                  # read-only UI checks against live Arc testnet, 5 viewport widths
ORBIT_LIVE_E2E=1 ORBIT_E2E_PRIVATE_KEY=0x… pnpm exec playwright test e2e/live.spec.ts
                               # signs real testnet txs through the UI with a throwaway key
```

## Operate (testnet)

```sh
pnpm deploy:orbit [--broadcast]     # Morpho + oracle + market + MofuLaunch (idempotent, gas-capped)
pnpm oracle:refresh [--broadcast]   # re-post tETH price from the pool (oracle max age: 30 days)
pnpm monitor [testnet|mainnet]      # health + solvency checks; ALERT_WEBHOOK_URL for alerts
pnpm verify:mainnet                 # Phase 0: verify mainnet dependencies (read-only)
pnpm deploy:mainnet                 # Phase 4 plan; refuses to broadcast until every gate passes
pnpm agent plan | rebalance --execute  # fund manager CLI (see docs/AGENT.md)
```

The deployer key is read from the git-ignored `.env` (`ARC_TESTNET_DEPLOYER_PRIVATE_KEY`) or the encrypted keystore. It is never printed or bundled.
