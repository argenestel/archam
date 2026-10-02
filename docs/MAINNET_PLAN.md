# Arc mainnet plan and status

Updated 2026-10-02. Branch `main`. **Mofu is live on Arc mainnet in hackathon mode** (unaudited, single-wallet owner, launches enabled): MofuLaunch `0xB583aD345d9261F267D6966f2D965C40E25e5cb4`. See [MAINNET_PLAN.md](MAINNET_PLAN.md#hackathon-deployment-live). The production gates below still apply to any production release. The opt-in existing-protocol hub is available via `pnpm dev:mainnet`; see [MAINNET_APP.md](MAINNET_APP.md) for scope, checks, and remaining risks. Custom Orbit deployment gates below remain unchanged.

## What changed since the first draft

- **Arc's docs list no Uniswap (v2, v3 or v4), Aave or Morpho addresses.** Third-party protocols aren't in Arc's registry. Uniswap's own Arc playbook lists v4 PoolManager and v3 addresses (some truncated); **no Uniswap V2 exists on Arc mainnet.**
- Arc's official **Circle App Kit** provides Swap (USDC/EURC/cirBTC), Earn (Morpho vaults) and Borrow (cirBTC → USDC) on both mainnet and testnet. Orbit uses it instead of hand-written Uniswap v3 / Aave V4 adapters: one reviewed integration, same code on both networks, protocol-agnostic.
- Safe 1.3/1.4.1 is deployed on Arc mainnet at the canonical addresses, so the multisig needs no custom deployment.

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| **0. Verify addresses** | **Done** | `pnpm verify:mainnet` writes `deployments/arc-mainnet.json`: 21 contracts verified on-chain (including Universal Routers), 30 Morpho Earn vaults and 13 borrowing markets discovered, 0 missing |
| **1. Swap and lending on mainnet** | **Opt-in beta; no real-fund execution tested** | Earn vaults + stablecoin swap through App Kit in `src/lib/appkit.ts`, `src/pages/Earn.tsx`, `src/pages/StableSwap.tsx`. Mainnet build shows live curated vaults (e.g. Bitwise Premium RWA USDC, 4.27%); writes need `VITE_MAINNET_SIGNING=1`. Testnet earn deposit/withdraw verified live via the agent. |
| **2. Launch contract hardening** | **Done, except the audit** | Two-step ownership, launch-only pause, capped pages, `curveState` view. A testnet graduation rehearsal found a sell-out rounding bug; it's fixed and pinned by a regression fuzz test. Foundry suite: 4 invariants × 7,680 random calls, 8 unit/fuzz tests. Graduation verified on-chain (pool price = curve price to 8 significant figures, LP 100% burned). Independent second-opinion review: 2 hardening items adopted, 3 "critical" claims refuted. **Independent audit: not done.** |
| **3. Operations** | **Partly done** | `pnpm monitor [testnet\|mainnet]`: RPC lag, launch solvency, owner type, oracle age, agent gas, webhook alerts. Points fixed (volume-only). Risks page live. Terms/privacy drafts in `docs/legal/`. Foundry and policy tests can be run manually; the unused GitHub Actions workflow was removed. **Open:** domain/TLS host, Docker validation (no Docker daemon here), legal review, Safe creation. |
| **4. Staged launch** | **Prepared** | `pnpm deploy:mainnet` prints the plan (≈0.25 USDC gas) and refuses to broadcast until all gates pass. It deploys the V2 factory/router (router WETH = USDC per Arc guidance) and `MofuLaunch` (5,000 USDC virtual reserve, graduates at ≈14.2k), **paused**, with ownership offered to the Safe. Testnet rehearsal done. |

## Gates enforced by `scripts/deploy-mainnet.mjs`

1. `MAINNET_MULTISIG`: a deployed Safe.
2. `MAINNET_DEPLOYER_PRIVATE_KEY`: a fresh key, not the testnet key.
3. `ORBIT_AUDITED_SOURCE_HASH` equals the hash of the exact audited source (any later edit invalidates it).
4. `ORBIT_AUDIT_REPORT`: the report file exists.
5. `ORBIT_MAINNET_CONFIRM=deploy-orbit-mainnet` and `--broadcast`.

## What only you can do

1. **Commission the audit** of `contracts/src/MofuLaunch.sol` + `MofuToken.sol` (source hash printed by `pnpm deploy:mainnet`).
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

## Hackathon deployment (live)

The owner chose an explicit, unaudited hackathon release instead of waiting for the production gates. It was deployed with `scripts/deploy-hackathon.mjs`, a separate mode that never sets audit attestations. Verified on-chain on 2026-10-02:

| Item | Value |
| --- | --- |
| UniswapV2Factory | `0x58498B4267D7479d6A5E14a8342ce18e08997378` (canonical v2-core 1.0.1) |
| UniswapV2Router02 | `0xe7a42B28f488543a11A75194D44ddC54859D1779` (WETH slot = USDC `0x3600…`; `factory()` checked) |
| **MofuLaunch** | **`0xB583aD345d9261F267D6966f2D965C40E25e5cb4`** |
| Owner and fee recipient | `0x9dF0F47ce262930a0370945A78596d3F6957f822` (single EOA, **not** a Safe) |
| Parameters | 5,000 USDC virtual reserve (graduates at ≈14.2k USDC), 1% fee, `TOTAL_SUPPLY` = actual minted 999,986,011.18 |
| State | `launchesPaused = false` (deployed paused, then enabled); 0 launches so far |
| Transactions | Factory, Router, MofuLaunch, Enable launches: all `success` (blocks 23875539–23875636); runtime hashes match the manifest |
| Deployer gas left | ≈1.53 USDC, nonce 4 |
| Records | `deployments/arc-mainnet.json` → `mofu` and `launch`; full signed-transaction journal in git-ignored `storage/mainnet-deployment.json` |

**Known gaps at the time of this update:**

1. **The deployed bytecode comes from uncommitted source.** The `MofuLaunch.sol` changes (paused-at-construction, corrected `TOTAL_SUPPLY`), `deploy-hackathon.mjs`, `scripts/lib/deployment-journal.mjs` and the updated manifests exist only in the working tree. Commit them so the repository reproduces what is on mainnet.
2. **The frontend is not wired to the deployment.** `src/lib/contracts.ts` still reads launch contracts from the testnet manifest only, and the mainnet footer says "Mofu launches are disabled". Meanwhile the contract accepts launches from anyone calling it directly.
3. Unaudited; owner is a single hot wallet that can pause new launches and change the fee recipient (it cannot pause trading or move user funds).
4. Open review findings L-02 (donation-sensitive bootstrap price) and L-04 (unbounded `positionsOf`); see [CONTRACT_AUDIT.md](CONTRACT_AUDIT.md).
5. No mofu.lol DNS/hosting/TLS, and the `public/mofu.svg` favicon referenced by `index.html` is missing.
