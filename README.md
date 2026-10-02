# Orbit — launch, trade and lend on Arc

**Release status: Arc testnet beta. Not approved for mainnet funds.** See [release gates](docs/RELEASE.md).
**Start every update with [the project reference](docs/PROJECT_REFERENCE.md).**

Orbit is a FOMO-style trading app for [Arc](https://arc.io), Circle's stablecoin-native L1:

- **Discover (launches):** anyone launches a fixed-supply token in one transaction. It trades against **real Arc USDC** on a virtual-reserve bonding curve. At ~57 USDC raised (testnet), the curve **graduates**: its USDC and reserved tokens are minted into a Uniswap V2 pool and the LP is burned. Includes King of the Orbit, live trade ticker/feed, per-token chart, trades and positions.
- **Social:** follow traders (private browser watchlist), "Following" feed, in-app alerts when a followed wallet trades, one-tap **copy trade**.
- **Leaderboard & points:** P&L (marked to market), volume and points, all recomputed from on-chain launch-contract state. There is no off-chain database. Points have no monetary value.
- **Swap:** canonical Uniswap V2 router, best of direct/hub routes, exact approvals, slippage minimums.
- **Lend:** a canonical **Morpho Blue** isolated market (tETH collateral → tUSDC) with AdaptiveCurveIrm rates, health factor, and supply/withdraw/collateral/borrow/repay.
- **Portfolio:** balances, launch positions with P&L, lending position, points level, local transaction history.

## Run

```sh
pnpm install
pnpm dev            # http://localhost:5191
pnpm build && pnpm preview
```

`VITE_ARC_NETWORK=mainnet pnpm build` produces a mainnet build (chain 5042). It enables only features with a recorded mainnet deployment, so today every Orbit-operated feature shows a "not live on this network" state instead of pointing at testnet contracts.

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
pnpm test:e2e                  # read-only UI checks against live Arc testnet, 5 viewport widths
ORBIT_LIVE_E2E=1 ORBIT_E2E_PRIVATE_KEY=0x… pnpm exec playwright test e2e/live.spec.ts
                               # signs real testnet txs through the UI with a throwaway key
```

## Operate (testnet)

```sh
pnpm deploy:orbit [--broadcast]     # Morpho + oracle + market + OrbitLaunch (idempotent, gas-capped)
pnpm oracle:refresh [--broadcast]   # re-post tETH price from the pool (oracle max age: 30 days)
```

The deployer key is read from the git-ignored `.env` (`ARC_TESTNET_DEPLOYER_PRIVATE_KEY`) or the encrypted keystore. It is never printed or bundled.
