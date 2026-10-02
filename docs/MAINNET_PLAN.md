# Arc mainnet plan and status

Updated 2026-10-02. Branch `feat/fomo-launch-morpho`. **No mainnet transaction has been sent.**

## What changed since the first draft

- **Arc's docs list no Uniswap (v2, v3 or v4), Aave or Morpho addresses.** Third-party protocols aren't in Arc's registry. Uniswap's own Arc playbook lists v4 PoolManager and v3 addresses (some truncated); **no Uniswap V2 exists on Arc mainnet.**
- Arc's official **Circle App Kit** provides Swap (USDC/EURC/cirBTC), Earn (Morpho vaults) and Borrow (cirBTC → USDC) on both mainnet and testnet. Orbit uses it instead of hand-written Uniswap v3 / Aave V4 adapters: one reviewed integration, same code on both networks, protocol-agnostic.
- Safe 1.3/1.4.1 is deployed on Arc mainnet at the canonical addresses, so the multisig needs no custom deployment.

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| **0. Verify addresses** | **Done** | `pnpm verify:mainnet` writes `deployments/arc-mainnet.json`: 16 contracts verified on-chain, 30 Morpho Earn vaults discovered, 0 missing |
| **1. Swap and lending on mainnet** | **Built; signing gated** | Earn vaults + stablecoin swap through App Kit in `src/lib/appkit.ts`, `src/pages/Earn.tsx`, `src/pages/StableSwap.tsx`. Mainnet build shows live curated vaults (e.g. Bitwise Premium RWA USDC, 4.27%); writes need `VITE_MAINNET_SIGNING=1`. Testnet earn deposit/withdraw verified live via the agent. |
| **2. Launch contract hardening** | **Done, except the audit** | Two-step ownership, launch-only pause, capped pages, `curveState` view. A testnet graduation rehearsal found a sell-out rounding bug; it's fixed and pinned by a regression fuzz test. Foundry suite: 4 invariants × 7,680 random calls, 8 unit/fuzz tests. Graduation verified on-chain (pool price = curve price to 8 significant figures, LP 100% burned). Independent second-opinion review: 2 hardening items adopted, 3 "critical" claims refuted. **Independent audit: not done.** |
| **3. Operations** | **Partly done** | `pnpm monitor [testnet\|mainnet]`: RPC lag, launch solvency, owner type, oracle age, agent gas, webhook alerts. Points fixed (volume-only). Risks page live. Terms/privacy drafts in `docs/legal/`. CI runs Foundry and the policy tests. **Open:** domain/TLS host, Docker validation (no Docker daemon here), legal review, Safe creation. |
| **4. Staged launch** | **Prepared** | `pnpm deploy:mainnet` prints the plan (≈0.25 USDC gas) and refuses to broadcast until all gates pass. It deploys the V2 factory/router (router WETH = USDC per Arc guidance) and `OrbitLaunch` (5,000 USDC virtual reserve, graduates at ≈14.2k), **paused**, with ownership offered to the Safe. Testnet rehearsal done. |

## Gates enforced by `scripts/deploy-mainnet.mjs`

1. `MAINNET_MULTISIG`: a deployed Safe.
2. `MAINNET_DEPLOYER_PRIVATE_KEY`: a fresh key, not the testnet key.
3. `ORBIT_AUDITED_SOURCE_HASH` equals the hash of the exact audited source (any later edit invalidates it).
4. `ORBIT_AUDIT_REPORT`: the report file exists.
5. `ORBIT_MAINNET_CONFIRM=deploy-orbit-mainnet` and `--broadcast`.

## What only you can do

1. **Commission the audit** of `contracts/src/OrbitLaunch.sol` + `OrbitToken.sol` (source hash printed by `pnpm deploy:mainnet`).
2. **Create the Safe** on Arc (app.safe.global, or the factory at `0x4e1D…ec67`), choose its signers and threshold, and fund a fresh deployer key with ~1 USDC.
3. **Legal:** terms, privacy, and a geo/eligibility review for a token-launch product (drafts in `docs/legal/`).
4. **Hosting:** a domain and host with Docker; set `ALERT_WEBHOOK_URL` and schedule `pnpm monitor mainnet`.
5. **Circle API key** (server-side only) for higher App Kit rate limits on the agent.
6. **Decide whether graduation stays on a project-deployed Uniswap V2.** It's what the audit would cover. The alternative is moving to Uniswap v4, a contract change.

## Rollout once the gates close

1. Ship the mainnet build with `VITE_MAINNET_SIGNING=1` (swap + earn only; launches show "not open").
2. `pnpm deploy:mainnet --broadcast` → the Safe calls `acceptOwnership()`.
3. Team launch + small graduation rehearsal on mainnet with launches still paused for the public.
4. Safe calls `setLaunchesPaused(false)`; watch `pnpm monitor mainnet` closely for the first week.
