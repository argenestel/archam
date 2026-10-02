# Arc mainnet plan

Status: **proposal, not approved.** Prepared 2026-10-02 on branch `feat/fomo-launch-morpho`.
Nothing here has been deployed or broadcast to mainnet.

## Principles

1. **Integrate before you deploy.** Swap and lending use the protocol-operated mainnet deployments. Orbit deploys only what doesn't exist yet: the launch contract.
2. **Every address comes from an official registry and is checked on-chain** (bytecode exists, expected `factory()`/`owner()` relationships hold) before it goes into `deployments/arc-mainnet.json`. Search results and blog posts are leads, not sources.
3. **The testnet key never touches mainnet.** Mainnet admin roles belong to a multisig. Deploys happen from a fresh hardware-backed key that hands over ownership in the same script run.
4. **Reversible rollout.** Each phase ships behind the existing "feature enabled only if it has a mainnet manifest entry" gate.

## Phase 0 — address verification (no transactions)

| Integration | Known so far | Where to confirm |
| --- | --- | --- |
| Chain | ID 5042, RPC `rpc.mainnet.arc.io` (+ QuickNode, dRPC, Blockdaemon), explorer `explorer.arc.io` | [Arc docs](https://docs.arc.io/arc/references/connect-to-arc) |
| Circle assets | USDC `0x3600…0000` (6d ERC-20), EURC `0xbEf5f6d5…21c1`, cirBTC `0x171A4217…bAA0`, WETH `0x128cC466…4EDB` | [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses) |
| Uniswap | v4 PoolManager `0x8366a39c…0951`; v3 factory, SwapRouter02 and v4 Quoter only published truncated | [Uniswap Arc playbook](https://github.com/Uniswap/UniswapX/blob/main/playbook/chains/arc.md), Uniswap deployment docs |
| Aave V4 | Arc Core Hub + Main Spoke + Forex Spoke (USDC, EURC, cirBTC, WETH); addresses not yet found | [Aave addresses dashboard](https://aave.com/docs/resources/addresses), [ARFC](https://governance.aave.com/t/arfc-deploy-aave-v4-on-arc/25170) |
| Morpho | Morpho Blue + Vault V2 live on 5042; address not yet confirmed | [Morpho addresses](https://docs.morpho.org/get-started/resources/addresses/), `morpho-org/sdks` registry |
| Infra | Permit2 `0x0000…22D4…8BA3`, Multicall3 `0xcA11…CA11`, CREATE2 `0x4e59…956C` | Arc docs |

Output: `scripts/verify-mainnet.mjs`, which is read-only. It checks code at every address and cross-checks factory/router/pool relationships, then writes `deployments/arc-mainnet.json` with runtime hashes. The UI already refuses to sign if a manifest hash changes.

## Phase 1 — read-only mainnet build

- Fill `src/lib/contracts.ts` for mainnet from `arc-mainnet.json`.
- **Swap:** add a **Uniswap v3** adapter (QuoterV2 `quoteExactInput`, SwapRouter02 `exactInput`, fee tiers 100/500/3000/10000, multi-hop through USDC). Then add v4 via the Universal Router once its address is confirmed. Use Permit2 for approvals where the router supports it, otherwise exact ERC-20 approval.
- **Lend:** integrate the **Morpho Blue** markets that Morpho lists for 5042 first. That reuses the existing `Lend` page and `useMarket`, with real oracles and their IRM. The **Aave V4** hub/spoke adapter comes second; it is a new ABI, so it needs fork tests.
- Show real oracle sources and per-market caps, and pause a market whenever the oracle is stale.
- Exit: mainnet build reads real markets; all signing buttons stay disabled behind a `VITE_MAINNET_SIGNING` flag.

## Phase 2 — launch contract hardening (blocks mainnet launches)

| Item | Detail |
| --- | --- |
| Independent audit | `OrbitLaunch.sol` and `OrbitToken.sol`, including the graduation path. Fix findings and re-test. |
| Pre-audit changes | Pause switch for new launches only (never trapping funds); a two-step `Ownable2Step` handover; a fee cap kept immutable at ≤2%; event-based indexing documented |
| Mainnet parameters | Virtual quote reserve ~5,000 USDC (graduates at ~14.2k raised), 1% fee. Graduation target: Uniswap V2 if a canonical v2 factory exists on Arc, otherwise a **v3 full-range position** with the NFT sent to a burn/lock address. This choice changes the contract, so it must be settled before the audit. |
| Tests | Foundry fuzz/invariant suite: curve solvency (`balance == Σ realQuote + fees`), no stuck graduation, rounding never favors the trader; fork test against mainnet USDC + router |
| Source verification | Verify on `explorer.arc.io`, with constructor args recorded in the manifest |
| Abuse / UX | Ticker/name filter (impersonation of Circle/USDC/known brands), report-and-hide list in the UI, explicit risk disclosure before the first buy |

## Phase 3 — operations and compliance

- Multisig (e.g. Safe, if deployed on Arc; verify) owns `OrbitLaunch` and receives fees.
- Public hosting: domain, TLS/HSTS, the Nginx container with mainnet RPC routes (already in `deploy/nginx.conf`), and an Alchemy/QuickNode key behind the proxy, never in the bundle.
- Monitoring: RPC health, graduation failures, fee balance, oracle staleness alerts, and error telemetry without wallet PII.
- Legal: terms, privacy policy, jurisdiction/geo review for a token-launch product, and points wording ("no monetary value").
- Points: wash-trade filtering, or a minimum net-volume rule, before points are shown as a ranking on mainnet.

## Phase 4 — staged launch

1. Mainnet build with swap + lending only (Phases 0–1, signing on).
2. Deploy the audited `OrbitLaunch` with a pause on new launches, then an internal launch plus a small graduation rehearsal funded by the team.
3. Open launches to the public with caps monitored for the first week.

## Decisions needed from you

1. **Graduation venue:** Uniswap v2 (only if an official v2 exists on Arc), v3 full-range locked, or v4.
2. **Auditor and budget** for `OrbitLaunch`.
3. **Multisig signers** and the fee recipient.
4. **Lending priority:** Morpho markets first (reuses the current UI) or Aave V4 first.
5. **Domain/hosting** account, and legal review owner.
6. **Mainnet parameters:** virtual reserve, fee, and whether creators get a fee share.

## Estimated effort (engineering only, excluding audit wait)

| Phase | Estimate |
| --- | --- |
| 0 Verification script + manifest | 1 day |
| 1 Uniswap v3 + Morpho mainnet adapters, fork tests | 4–6 days (+3 for Aave V4) |
| 2 Contract hardening + Foundry suite | 4–5 days, then the audit |
| 3 Ops/hosting/monitoring | 2–3 days |
