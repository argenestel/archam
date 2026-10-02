# Orbit — launch, trade and lend on Arc

**Release status: testnet beta plus an opt-in mainnet protocol hub beta (not production-certified).** Existing protocol swaps/vaults/cirBTC-backed loans: [mainnet app setup and limitations](docs/MAINNET_APP.md). Custom Orbit mainnet contracts remain gated by audit, Safe, and legal review: [mainnet plan](docs/MAINNET_PLAN.md). See [release gates](docs/RELEASE.md).
**Start every update with [the project reference](docs/PROJECT_REFERENCE.md).**

Orbit is a FOMO-style trading app for [Arc](https://arc.io), Circle's stablecoin-native L1:

- **Discover (launches):** anyone launches a fixed-supply token in one transaction. It trades against **real Arc USDC** on a virtual-reserve bonding curve. At ~57 USDC raised (testnet), the curve **graduates**: its USDC and reserved tokens are minted into a Uniswap V2 pool and the LP is burned. Includes King of the Orbit, live trade ticker/feed, per-token chart, trades and positions.
- **Social:** follow traders (private browser watchlist), "Following" feed, in-app alerts when a followed wallet trades, one-tap **copy trade**.
- **Leaderboard & points:** P&L (marked to market) and volume-based points, recomputed from on-chain launch-contract state. Points have no monetary value and can't be farmed for free.
- **Swap:** USDC↔EURC through Circle App Kit (mainnet + testnet), plus Orbit's Uniswap V2 pools on testnet.
- **Lend:** curated Morpho **Earn vaults** through Circle App Kit, plus a canonical Morpho Blue test market (tETH → tUSDC) with health factor and the full borrow cycle.
- **Fund-manager agent:** an MCP server that Claude Code or Codex drives to read market data and swap, lend and rebalance within a policy you set. See [docs/AGENT.md](docs/AGENT.md).
- **Portfolio:** balances, launch positions with P&L, lending position, points level, local transaction history.

## Run

```sh
pnpm install
pnpm dev            # http://localhost:5191
pnpm build && pnpm preview
```

`pnpm dev:mainnet` starts the opt-in mainnet protocol hub at **http://localhost:5193**; `pnpm build:mainnet` writes `dist-mainnet/`. Use your own wallet; never send funds directly to Orbit or router addresses. See [mainnet beta documentation](docs/MAINNET_APP.md) before funding.

`VITE_ARC_NETWORK=mainnet pnpm build` produces a read-only mainnet build (chain 5042). It enables only features with a recorded mainnet deployment, so today every Orbit-operated feature shows a "not live on this network" state instead of pointing at testnet contracts.

## Logos and profiles

Launches use a responsive card grid. Optional token logos and wallet-authorized public profiles are pinned to Pinata/IPFS. Set server-only `PINATA_JWT` in `.env`, run `pnpm media` alongside Vite, or deploy with `docker compose up --build -d`. See [IPFS setup and storage limitations](docs/IPFS.md). Never put Pinata secrets in `VITE_*` variables.

## Contracts

| Contract | Source | Notes |
| --- | --- | --- |
| `OrbitLaunch` / `OrbitToken` | `contracts/src/` (new, **unaudited**) | Bonding curve, on-chain trade feed and trader stats, grief-resistant graduation |
| Morpho Blue + AdaptiveCurveIrm | `contracts/vendor/` (upstream, unmodified, pinned commits) | Built with upstream settings (solc 0.8.19, via-IR) |
| `OrbitTestnetOracle` | `contracts/src/` | Owner-posted **testnet-only** price with staleness guard |
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
pnpm deploy:orbit [--broadcast]     # Morpho + oracle + market + OrbitLaunch (idempotent, gas-capped)
pnpm oracle:refresh [--broadcast]   # re-post tETH price from the pool (oracle max age: 30 days)
pnpm monitor [testnet|mainnet]      # health + solvency checks; ALERT_WEBHOOK_URL for alerts
pnpm verify:mainnet                 # Phase 0: verify mainnet dependencies (read-only)
pnpm deploy:mainnet                 # Phase 4 plan; refuses to broadcast until every gate passes
pnpm agent plan | rebalance --execute  # fund manager CLI (see docs/AGENT.md)
```

The deployer key is read from the git-ignored `.env` (`ARC_TESTNET_DEPLOYER_PRIVATE_KEY`) or the encrypted keystore. It is never printed or bundled.
