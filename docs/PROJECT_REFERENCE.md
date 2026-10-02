# Orbit — product reference, implementation status, and update roadmap

> **Start here for every future update.** This document records what the product is supposed to become, what actually exists, what must not be assumed, and how changes should be requested and accepted.
>
> **Current release: Arc testnet beta (launch curves, social feed, Morpho lending). Not approved for mainnet funds.** A clean interface, successful transactions, and passing tests do not establish safety for real funds.

- Last reviewed: **2026-10-02 UTC**.
- Implementation baseline: **2026-10-02 FOMO/Morpho release** (see decision log).
- Product name: **Orbit**; package name: `arc-terminal`.
- Default development URL: **http://localhost:5191**.
- Intended audience: traders who want simple swaps, launch discovery, lending, portfolio tracking, and regular-trader progression on Arc.
- Product/design approval: **pending**. The latest interface is a revised baseline, not a user-approved final design.

## Contents

1. [How to use this reference](#1-how-to-use-this-reference)
2. [Product brief and priorities](#2-product-brief-and-priorities)
3. [Current scope: live versus demo](#3-current-scope-live-versus-demo)
4. [UX direction and acceptance criteria](#4-ux-direction-and-acceptance-criteria)
5. [Architecture and file map](#5-architecture-and-file-map)
6. [Arc configuration and deployments](#6-arc-configuration-and-deployments)
7. [Transaction and custody rules](#7-transaction-and-custody-rules)
8. [RPC and hosting requirements](#8-rpc-and-hosting-requirements)
9. [Launchpad behavior and limitations](#9-launchpad-behavior-and-limitations)
10. [Lending integration requirements](#10-lending-integration-requirements)
11. [Portfolio and XP requirements](#11-portfolio-and-xp-requirements)
12. [Known gaps and production gates](#12-known-gaps-and-production-gates)
13. [Prioritized update backlog](#13-prioritized-update-backlog)
14. [Implementation milestones](#14-implementation-milestones)
15. [Development, validation, and operations](#15-development-validation-and-operations)
16. [Definition of done](#16-definition-of-done)
17. [Future-update request templates](#17-future-update-request-templates)
18. [Document maintenance and decision log](#18-document-maintenance-and-decision-log)

---

## 1. How to use this reference

### For the owner

Point an implementer or coding assistant to this file and specify a backlog ID, section, or acceptance criterion. Do not have to repeat the entire conversation.

Example:

> Read `docs/PROJECT_REFERENCE.md`. Implement `TX-01`, including its acceptance criteria. Preserve the compact UI and testnet-only restrictions. Update the documentation and commit a working milestone.

### For an implementer

1. Read this reference and the linked specialist document for the task.
2. Inspect the current source, manifest, and Git status; the snapshot here may be older than the working tree.
3. State which behavior will change and which behavior will remain out of scope.
4. Make a bounded, reviewable update rather than another broad redesign or protocol rewrite.
5. Test failure paths as well as the happy path.
6. Record evidence, limitations, changed files, and a commit.
7. Update this reference and affected specialist documents before handing off.

### Source-of-truth order

| Information                                                    | Authority                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| Current runtime behavior                                       | Source code and reproducible tests                           |
| Deployed addresses, constructor arguments, deployment receipts | `deployments/arc-testnet.json`, checked against the chain    |
| Current balances, allowances, reserves, sale status            | Fresh onchain reads; not this document                       |
| Product requirements and agreed scope                          | This document plus recorded owner decisions                  |
| Release readiness                                              | Evidence against release gates; not a UI label or test count |

Do not silently resolve a material disagreement between code, chain data, and documentation. Report it, reconcile it, and update the relevant record.

### Specialist documents

- [README](../README.md): quick start and repository overview.
- [DESIGN.md](DESIGN.md): current visual direction.
- [RELEASE.md](RELEASE.md): readiness status and blocking gates.
- [DEPLOYMENT.md](DEPLOYMENT.md): protocol/deployment checks.
- [TESTNET.md](TESTNET.md): wallet, deployment, smoke checks, and hosting commands.
- [RPC.md](RPC.md): proxy architecture and troubleshooting.

## 2. Product brief and priorities

### Original objective

Build a fully featured but simple DeFi trading terminal on Arc using working protocols/contracts where possible:

- Sushi-like swap and liquidity discovery workflows.
- Aave-like lending workflows without unnecessary complexity.
- Launchpad sales/pools.
- Jumper-inspired restrained colors and simple interactions.
- XP/progression for regular traders.
- Bootstrap the project and commit usable milestones.

### Feedback that must inform future work

The owner rejected the earlier interfaces as cluttered, insufficiently polished, and not production-ready. Adding more cards, headings, warnings, illustrated panels, or tests was not an adequate response by itself.

The latest revision therefore separates two concerns:

1. **UX:** reduce the live interface to the user's next action, with secondary information on demand.
2. **Readiness:** identify and close real security, integration, transaction, and operational gaps with evidence.

Do not recreate the earlier dashboard by gradually adding every secondary feature back onto the swap screen.

### Product priorities

1. Correct, understandable transaction behavior.
2. A cohesive, owner-approved interface.
3. Verified assets and protocol integrations on the actual target chain.
4. Reliable hosting and operational recovery.
5. Portfolio indexing and lending.
6. Receipt-verified XP, after reliable transaction/accounting infrastructure exists.

These priorities are a proposed implementation order, not permission to discard the original feature goals.

### Non-goals for the current preview

- Mainnet transactions or accepting real-value funds.
- Pretending test tokens are Circle USDC or real ETH.
- Inventing an Arc Aave deployment, router liquidity, APY, volume, or price history.
- Building a new lending engine from copied pool code without oracles, governance, and liquidation infrastructure.
- Treating browser-local points as verified rewards or financial entitlements.
- Calling the custom sale contract audited because it imports OpenZeppelin.

## 3. Current scope (testnet)

| Area | Implemented | Important limitation |
| --- | --- | --- |
| Launches | `OrbitLaunch`: one-tx token launch, virtual-reserve curve priced in real Arc USDC (`0x3600…`), 1% fee, slippage + deadline, sells without approval, graduation into Uniswap V2 with LP burned | New, unaudited contract. Testnet virtual reserve is 20 USDC (graduates at ~57 USDC) |
| Social / FOMO | Live ticker and feed, King of the Orbit, follow (browser watchlist), Following feed, followed-trade alerts, copy-trade prefill | Follows are local; alerts only while the app is open |
| Leaderboard / points | P&L, volume and points recomputed from on-chain `tradersPage`/`positionsOf` views | Points are not wash-trade resistant and carry no value |
| Swap | Uniswap V2 router; best of direct and hub (USDC/tUSDC/tETH) paths; graduated launches become swappable | One seeded test pool plus graduated pairs; not an aggregator |
| Lending | Morpho Blue market (tETH → tUSDC, 86% LLTV, AdaptiveCurveIrm); supply, withdraw (by shares for max), collateral, borrow, repay (by shares for full), health factor | Orbit-deployed instance + owner-posted testnet oracle |
| Portfolio | Balances, launch positions with P&L, lending summary, points level, local tx history | Activity list is browser-local |
| Wallet / tx | EIP-6963 discovery, silent session restore, chain switch/add, runtime-bytecode check before signing, simulate + 25% gas buffer, hash recorded before receipt, unknown vs reverted outcomes, reload recovery | Replacement/cancellation detection still incomplete (TX-01) |
| Network | `VITE_ARC_NETWORK=testnet\|mainnet`; mainnet chain 5042 config, RPC proxies and Circle asset addresses | No Orbit mainnet deployment; mainnet builds disable Orbit features |

The old virtual demo workspace was removed in this release.

### Live navigation

Discover (launches), Swap, Lend, Leaders, Portfolio, plus the **Launch** button.

## 4. UX direction and acceptance criteria

### Current design baseline

- One centered exchange card.
- Quiet horizontal navigation and wallet control.
- One primary action at a time: connect, approve/reset allowance, review, or check an unresolved transaction.
- Empty amount input by default; no suggested prefilled trade.
- Clear sell/buy token controls and balances beside inputs.
- Faucet behind **Get test tokens**.
- Pool/contract information behind an expandable disclosure.
- Full risk explanation available on demand, while testnet status remains visible.
- Self-hosted DM Sans Variable for controls and Space Grotesk Variable for amounts.
- Neutral near-white surfaces and one muted purple accent.

### Avoid

- Repeated page greetings or marketing headlines above a functional form.
- Always-visible tutorial, faucet, XP, and pool illustration cards.
- Several competing primary buttons.
- Fake chart data in the live workspace.
- Disabled navigation that looks like an implemented market.
- Accumulating CSS override files instead of maintaining one live design system.
- Hiding essential safety information to make a screenshot cleaner.

### Design acceptance checklist

An update to the interface is not accepted merely because it looks different.

- [ ] Owner approves screenshots/reference direction before a broad visual rewrite.
- [ ] The next required action is identifiable without reading a tutorial.
- [ ] Disconnected, connected, wrong-network, loading, insufficient-balance, pending, failed, and successful states are designed.
- [ ] Mobile widths 360/390/768 and desktop widths 1280/1440 have no unintended horizontal overflow.
- [ ] All money/token amounts are legible and positive dust amounts are not rendered as zero.
- [ ] Keyboard focus, modal naming, modal dismissal, and screen-reader labels are correct.
- [ ] Visible button labels match accessible names.
- [ ] Contrast and touch targets receive a real audit, not only a screenshot review.
- [ ] Returning from demo does not change live styles or layout.
- [ ] No new live feature is presented without real backing data and failure states.

## 5. Architecture and file map

### Stack

React 19, TypeScript, Vite, viem, Lucide, Fontsource, OpenZeppelin, solc, Vitest, Ganache, and Playwright. Exact resolved versions are in `pnpm-lock.yaml`; use the lockfile rather than assuming the ranges in `package.json` identify the deployed compiler or runtime.

There is **no implemented application backend, authoritative portfolio indexer, rewards service, production database, or authenticated account API**.

### Request/signing paths

```text
Browser UI
  ├─ public reads / simulations / receipt checks
  │    └─ same-origin /api/arc-rpc* routes
  │         └─ fixed Arc public RPC endpoints
  ├─ wallet signing
  │    └─ injected EIP-1193 wallet on Arc testnet
  └─ local records
       └─ browser storage (activity + separate demo state)

Deployment / explicit smoke tooling
  └─ local testnet keystore outside the repository
       └─ explicit testnet broadcasts
```

The server does not sign browser-user transactions. A funded deployment wallet is not automatically connected to the user's browser wallet.

### Files to inspect before changing an area

| Area                                                    | Files                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Shell, nav, ticker, wallet picker, toasts, alerts       | `src/App.tsx`                                                             |
| Pages                                                   | `src/pages/{Discover,TokenPage,CreateLaunch,Swap,Lend,Leaders,Portfolio}.tsx` |
| Wallet (EIP-6963) / tx runner                           | `src/lib/wallet.tsx`, `src/lib/tx.tsx`                                    |
| Chain reads, polling cache, registry                    | `src/lib/data.ts`, `src/lib/query.ts`, `src/lib/contracts.ts`             |
| Curve/Morpho/points math                                | `src/lib/math.ts`                                                         |
| Launch + oracle contracts                               | `contracts/src/OrbitLaunch.sol`, `OrbitToken.sol`, `OrbitTestnetOracle.sol` |
| Vendored Morpho                                         | `contracts/vendor/` (see its README)                                      |
| Live visual system                                      | `src/app.css`                                                             |
| Swap/sale forms and dialogs                             | `src/LiveTerminal.tsx`                                                    |
| Reads, quotes, form state, transaction lifecycle        | `src/lib/useLiveTerminal.ts`                                              |
| Router/Aave ABI adapters and signing guards             | `src/lib/protocols.ts`                                                    |
| Arc chain and public client fallback                    | `src/lib/arc.ts`                                                          |
| Allowlist/runtime verification and token amount parsing | `src/lib/deployed.ts`                                                     |
| Wallet lifecycle and native gas balance                 | `src/lib/useWallet.ts`                                                    |
| Local submission/outcome storage                        | `src/lib/transactions.ts`                                                 |
| Amount display and friendly errors                      | `src/lib/format.ts`, `src/lib/errors.ts`                                  |
| Dialog/error boundary                                   | `src/components/`                                                         |
| Pool snapshot                                           | `src/PoolContext.tsx`                                                     |
| Virtual dashboard                                       | `src/DemoWorkspace.tsx`, `src/lib/market.ts`                              |
| Scoped legacy/demo styles                               | `src/styles.css`, `src/live.css`, `src/terminal-design.css`               |
| Experimental contracts                                  | `contracts/src/FixedPriceLaunchpad.sol`, `contracts/src/TestnetToken.sol` |
| Solidity checks and deploy/smoke tooling                | `scripts/`                                                                |
| Address/receipt manifests                               | `deployments/arc-testnet.json`, `public/arc-testnet-deployment.json`      |
| Dev/preview proxy                                       | `vite.config.ts`                                                          |
| Container/reverse proxy                                 | `Dockerfile`, `deploy/nginx.conf`, `deploy/rpc-proxy.conf`                |
| Unit/EVM/browser validation                             | `src/lib/*.test.ts`, `contracts/launchpad.test.js`, `e2e/`                |
| Proposed CI execution                                   | `.github/workflows/ci.yml`                                                |

### Separation rules

- Keep transaction logic out of styling components where practical.
- Use `src/app.css` as the single live visual system; do not add another global override layer.
- Keep demo quotes, balances, projects, and XP out of live transaction construction.
- A live API or backend introduced later must be documented as new infrastructure, with authentication, schema, deployment, privacy, and operational ownership.

## 6. Arc configuration and deployments

Source reference: [official Arc connection documentation](https://docs.arc.io/arc/references/connect-to-arc). Recheck it before a network change.

| Setting          | Current target                                                            |
| ---------------- | ------------------------------------------------------------------------- |
| Network          | Arc testnet                                                               |
| Chain ID         | `5042002` (`0x4cef52`)                                                    |
| Primary RPC      | `https://rpc.testnet.arc.io`                                              |
| Backups          | `https://rpc.quicknode.testnet.arc.io`, `https://rpc.drpc.testnet.arc.io` |
| Explorer         | `https://explorer.testnet.arc.io`                                         |
| Native gas token | USDC, 18 decimals                                                         |

**Native gas USDC and ERC20 token interfaces must not be conflated.** The current swap token is a custom faucet asset called tUSDC with 6 decimals, not Circle USDC. Verify actual token interfaces/decimals before a real-asset integration.

### Public deployment inventory

| Deployment            | Address                                      |
| --------------------- | -------------------------------------------- |
| Test tUSDC            | `0x995ac9f68d8fb92d240064692fa63af7cc02663c` |
| Test tETH             | `0x461124bf2a8677df03b9f7560060d81442551124` |
| Test tORBIT           | `0xece294e9110fb62e7fbd39b0b7d5b85934b69590` |
| Uniswap V2 factory    | `0x9c074d5f07ab2ad10bb00dfecbf22c14cd1de611` |
| Uniswap V2 Router02   | `0xa1ae04767893d81bed19272fee30746132e339de` |
| Wrapped native USDC   | `0x2c86de6dc916d593d4f029e9243ca24c82e13f82` |
| tUSDC/tETH pair       | `0xD2b4A96E2a39e66A33f4B0eC86150b48eB9a61aF` |
| Fixed-price launchpad | `0x3fed4122a1a924dcd0fd7ede9afd2dbba964b0c1` (legacy, no longer in UI) |
| Morpho Blue           | `0xb152667fc9c805edd704feecba373e65cabb109d` |
| AdaptiveCurveIrm      | `0x83652fc0887288283f9bc07e8b00292b600e2ca8` |
| OrbitTestnetOracle    | `0x15f6c41e138e5f7ddb71324b0c77db31c16a7d5b` |
| Morpho market id      | `0x12a7f36527343c328a938570419ef57996818a50ba6eeb3b487c6129804a9f46` |
| OrbitLaunch           | `0xa4915305bee76157e4d64a09d946d4a7349db6fe` |
| Arc USDC (ERC-20)     | `0x3600000000000000000000000000000000000000` (Circle; 6 decimals; same balance as gas) |

The factory/router use canonical published artifacts from `@uniswap/v2-core@1.0.1` and `@uniswap/v2-periphery@1.1.0-beta.0`. This is a project-deployed test stack, not evidence of an independently operated Arc marketplace.

The legacy WETH9 artifact required by Router02 wraps **native USDC on Arc**, despite its legacy metadata. Native-token routes and this wrapper are not exposed in the UI.

### Manifest rules

- Keep addresses, constructor arguments, receipts, and runtime hashes together.
- Update the public manifest copy when changing the deployment record.
- Do not change the allowlist by casually adding an environment variable or user-supplied address.
- Runtime-hash verification is integrity checking, not a security audit or source verification.
- Derive current reserve order from the pair's `token0()`/`token1()` calls. Do not assume the seed/configuration ordering in manifest metadata is the actual sorted onchain ordering.
- Do not use seeded liquidity metadata as current reserves.
- Never edit a recorded hash to bypass a failed runtime check.

### Historical execution evidence

The manifest records successful deployment receipts, a 1 tUSDC swap, and a 10 tUSDC sale contribution. Deployment gas recorded there is `0.358737675` native testnet USDC; smoke gas is `0.00958075`.

These are historical records, not a current wallet balance or proof that every user flow/edge case has been validated.

## 7. Transaction and custody rules

### Required transaction flow

```text
connect / correct chain
  → fresh balances + allowance + quote
  → explicit exact approval, if needed
  → review recipient / route / fee / minimum received / expiry
  → explicit wallet signature
  → immediately expose and record returned hash
  → pending receipt
  → confirmed OR reverted OR unknown confirmation
  → refresh balances and allowance
```

### Non-negotiable safeguards

- Use bigint/base-unit arithmetic for calldata and minimum amounts.
- Reject invalid, negative, zero, overflowing, and overprecision inputs.
- Do not automatically swap after an approval succeeds.
- Do not request unlimited approval by default.
- Explicitly reset a nonzero allowance when required by the supported flow.
- Revalidate wallet account and chain before signing.
- Require fresh quotes and honor the reviewed minimum output.
- Separate wallet rejection from a submitted transaction whose receipt is unavailable.
- Preserve returned hashes immediately, including across reload.
- Do not interpret a timeout as a revert.
- Do not turn a confirmed transaction into an unknown one because a later balance fetch fails.
- Do not award live XP on clicks, wallet prompts, approval submissions, or unverified receipts.
- Do not remove safety checks to make the UI appear responsive during an outage.

### Still incomplete

Full replacement/cancellation detection, multiple outstanding transactions, cross-tab coordination, and a provider that broadcasts without returning a hash require further work. Local guards do not prove that duplicate transactions are impossible.

### Deployment-wallet security

Public deployer: `0x1a86d3148df478a1071e9d3d4825c99fb75ec964`.

The encrypted testnet keystore/password are outside Git at `~/.local/share/orbit/arc-testnet/`, with owner-only file permissions. The password is co-located for unattended testing; this is **not a production secret-management design**.

At the owner's request, a plaintext testnet key copy is also present in the Git-ignored root `.env` as `ARC_TESTNET_DEPLOYER_PRIVATE_KEY` (mode 0600); `ARC_TESTNET_DEPLOYER_ADDRESS` stores the public address. Docker excludes `.env*`. Deployment scripts continue to use the encrypted keystore. This local convenience is not a production custody design.

Never print, copy into documentation, commit, bundle, or put a private key/password in `VITE_*`, CLI arguments, screenshots, or logs. Use hardware signing/multisig and properly managed secrets for any future production operations.

## 8. RPC and hosting requirements

### Same-origin routes

| Browser path             | Fixed upstream                       |
| ------------------------ | ------------------------------------ |
| `/api/arc-rpc`           | Official Arc RPC                     |
| `/api/arc-rpc-quicknode` | Officially listed QuickNode endpoint |
| `/api/arc-rpc-drpc`      | Officially listed dRPC endpoint      |

Vite dev/preview and the Nginx package implement these paths. Static-only hosting must add equivalent routes; uploading `dist/` alone is not sufficient.

Wallet network metadata uses public RPC URLs, never localhost proxy URLs.

### Prior reported error

The owner reported `HTTP request failed / Failed to fetch` for `eth_chainId`. The endpoint worked server-side, so the exact browser-side DNS/CORS/VPN/network failure was not established. Same-origin reads, fallback endpoints, friendly errors, and recovery were added; do not retroactively claim a specific root cause was proven.

### Hosting status

- Development server: default port 5191, IPv4/IPv6, strict port selection.
- Vite preview: local build inspection, not a hardened production service.
- Docker/Nginx package: prepared, with unprivileged hosting, proxy routes and security headers.
- Container runtime validation: not completed locally because the Docker daemon was unavailable.
- CI: configured to build/test and validate the hosting package; configuration is not evidence of a successful CI run.
- Public domain, hosting account, HTTPS/TLS/HSTS, monitoring: not supplied/configured as a deployed public release.

Do not stop unrelated applications to obtain a preferred development port. The earlier 5173 conflict motivated the dedicated 5191 default.

## 9. Launchpad behavior and limitations

### Current test sale parameters

| Parameter           | Recorded value         |
| ------------------- | ---------------------- |
| Payment asset       | tUSDC, 6 decimals      |
| Sale asset          | tORBIT, 18 decimals    |
| Price               | 2 tORBIT per tUSDC     |
| Soft cap            | 1,000 tUSDC            |
| Hard cap            | 200,000 tUSDC          |
| Prefunded inventory | 400,000 tORBIT         |
| Start               | `2026-10-01T15:19:43Z` |
| End                 | `2026-10-08T15:14:43Z` |

These timestamps are fixed historical deployment parameters. The UI must derive open/succeeded/failed/cancelled state from chain data; future updates must not keep calling an expired sale “open.”

### Contract behavior

- Whole hard-cap inventory must be funded before contributions can succeed.
- Contributions are capped and allocations round down in base units.
- Settlement occurs at sale end, not merely when a cap is reached.
- Successful raises permit claims and one proceeds withdrawal.
- Failed raises permit full payment refunds.
- Owner cancellation before the end closes contributions and enables refunds.
- Unsold inventory withdrawal retains successful unclaimed allocations.

### Not implemented

Sale factory, permissionless project listing, vetted project registry, whitelist/KYC policy, vesting, automated LP creation/locking, launch liquidity provisioning, or governance/moderation.

The contract is new, unaudited code using OpenZeppelin primitives. Only standard non-rebasing, non-fee ERC20s are supported. Native USDC is not the accepted payment interface in this test sale.

A future “launchpad pool” requirement must explicitly distinguish **sale escrow**, **AMM liquidity**, and **LP custody/locking**. The current sale does not automatically create a liquidity pool.

## 10. Lending integration requirements

### Current status

Morpho has **no official Arc testnet deployment** (as of 2026-10-02). Orbit therefore deployed the canonical Morpho Blue and AdaptiveCurveIrm from vendored upstream source (pinned commits, upstream compiler settings) and created one market: loan tUSDC, collateral tETH, LLTV 86%. It is seeded with 250k tUSDC supply and a 110k borrow, so the rates are live. The oracle is `OrbitTestnetOracle`: owner-posted from the test pool and reverting when older than 30 days (`pnpm oracle:refresh`).

On **Arc mainnet**, Aave V4 and Morpho operate their own markets. A mainnet integration must target those protocol-owned deployments and oracles. It must not reuse this testnet instance or oracle design.

### Before implementing live lending

The protocol integration record must include:

- Protocol identity, protocol-owned deployment registry, chain ID and ABI/version.
- Market/pool, asset, aToken/debt-token addresses and source verification.
- Supported reserve state, caps, supply/borrow availability and decimals.
- Oracle feeds, freshness rules and failure handling.
- Collateral parameters, liquidation threshold, LTV and interest-rate mode.
- Upgrade/admin/governance controls and protocol risk information.
- Fork/testnet evidence for supply, withdraw, repay, disabled reserve, insufficient liquidity and unhealthy account states.

### UI requirements

- Supply and withdrawal first; borrowing only when risk data is reliable.
- Current protocol APY, clearly variable and sourced; no fixture APY in live mode.
- Collateral/debt/health factor where relevant.
- Explain liquidation risk before enabling borrowing.
- Handle reserve pauses, caps, lack of liquidity and oracle outages.
- Show actual position data, not values borrowed from demo storage.

If no suitable verified Arc protocol exists, report the blocker. Do not relabel an ERC4626 vault as a full lending market or deploy copied Aave code and assume it is ready.

## 11. Portfolio and XP requirements

### Portfolio/activity

Current Activity is browser-local submission history. A real portfolio needs authoritative, chain-indexed balances/positions/transactions, documented price sources, freshness indicators, pagination, and account/chain isolation.

The proposed indexer/backend is **not implemented**. Its language, framework, database, deployment provider, authentication scheme, and retention policy are decisions still to be made.

### Production XP

Browser-local demo XP can be edited/reset and is not trustworthy.

A production XP system should:

1. Authenticate wallet ownership using a reviewed signed-session flow.
2. Index successful receipts and relevant logs on supported chains.
3. Use unique chain/transaction/log event keys to prevent replay.
4. Award points according to an explicit, versioned policy.
5. Apply daily caps, cooldowns and economic activity thresholds.
6. Filter self-trading, wash trading and obvious farming loops.
7. Handle reorgs, policy changes and reconciliation.
8. Expose account history and a correction/support process.
9. Document privacy, retention and any rewards terms.

Whether approvals, repayments, launch contributions, referrals, streaks or volume contribute to XP is **not yet a production policy**. Do not promise token distributions, financial returns, or payouts through points copy.

## 12. Known gaps and production gates

| Gate                                 | Current status  | Evidence needed to close                                                              |
| ------------------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| Owner-approved design                | Pending         | Approved desktop/mobile states and references, not another unilateral visual pass     |
| Independent contract security review | Blocked         | Audit/review findings, remediation, tests and ownership decision                      |
| Explorer source verification         | Blocked         | Verified source/compiler/constructor records and artifact provenance                  |
| Real supported assets/liquidity      | Blocked         | Protocol-owned registries, vetted tokens/bridges, actual liquidity and route evidence |
| Verified lending                     | Blocked         | Market/oracle/risk integration record and successful adverse-flow tests               |
| Backend/indexer                      | Not implemented | Architecture decision, deployed service, data correctness and recovery evidence       |
| Verified XP                          | Demo only       | Receipt ingestion, authentication, anti-abuse, replay/reorg tests                     |
| Advanced transaction recovery        | Partial         | Replacements, cancellations, uncertain broadcasts, cross-tab/multiple-pending tests   |
| Public hosting                       | Blocked         | Actual domain/host, validated container/routes, HTTPS/TLS/HSTS                        |
| Monitoring/support                   | Not implemented | Health/error/contract alerts, privacy policy, incident and user recovery runbooks     |
| Production custody/admin             | Blocked         | Multisig/hardware signing, proper secrets, documented admin rights                    |
| Accessibility/browser coverage       | Partial         | Independent contrast, screen-reader, touch and mobile-wallet matrix                   |

See [RELEASE.md](RELEASE.md) for the focused release status. Do not change a gate to “done” without linking reproducible evidence.

## 13. Prioritized update backlog

IDs are stable references for future requests. Owners below are **roles**, not assigned people.

### UX-01 — approve the visual baseline

- Priority: P0. Owner: product/design + frontend.
- Dependency: owner supplies/approves the target direction and important screen states.
- Deliverable: approved compact interface; remove any remaining awkward spacing, low-contrast information, confusing labels or unnecessary clicks.
- Acceptance: section 4 checklist, desktop/mobile screenshots, keyboard/screen-reader review, no live/demo style leak.
- Out of scope: adding dashboards or changing contracts just to make the page look busier.

### TX-01 — complete transaction recovery

- Priority: P0. Owner: frontend + protocol integration.
- Deliverable: replacement/cancellation handling, uncertain-broadcast recovery, cross-tab coordination and multiple pending submissions.
- Acceptance: deterministic tests for rejection, revert, timeout, replacement, cancellation, account/chain changes during signing, reload and second-tab races; no automatic resend; hashes and correct outcomes retained.
- Out of scope: assuming a timeout means failure or awarding points for an unresolved receipt.

### SEC-01 — review and verify deployment integrity

- Priority: P0. Owner: protocol/security.
- Deliverable: explorer source verification, canonical artifact provenance, reviewed sale code/parameters/admin controls.
- Acceptance: independent review with remediated findings; published implementation/constructor records; adversarial token, rounding, refund, inventory and liveness coverage.
- Dependency: qualified reviewer and deployment ownership decision.

### OPS-01 — establish a public testnet release

- Priority: P0. Owner: operations.
- Deliverable: chosen host/domain, validated container, HTTPS, all RPC proxy routes, monitoring and rollback.
- Acceptance: hosted health/header/proxy checks; failure/fallback behavior; no secrets in bundle/image; real mobile/browser test against the public domain.
- Dependency: hosting/domain/TLS access supplied securely, never committed.
- Important: a public **testnet** release is not a mainnet production approval.

### SWAP-01 — integrate real supported markets

- Priority: P1. Owner: protocol integration + frontend.
- Deliverable: vetted token registry and supported Arc liquidity/router/aggregator integration.
- Acceptance: fresh routes, source/version/address evidence, decimals/native handling, fee/impact/minimum/recipient review, stale/no-liquidity handling, fork and controlled testnet execution.
- Dependency: suitable protocol deployment and liquidity; report absence rather than inventing it.

### DATA-01 — build authoritative account data

- Priority: P1. Owner: backend/indexer + frontend.
- Deliverable: account-scoped transaction/position history and sourced valuation data.
- Acceptance: chain reconciliation, duplicate/reorg handling, pagination, stale-data states, documented retention/privacy, browser storage not used as authority.
- Dependency: backend/database/hosting architecture decision.

### LAUNCH-01 — turn the test sale into a launch workflow

- Priority: P1. Owner: protocol/security + frontend.
- Deliverable: defined launch model, project registry and operational policies; audited sale lifecycle.
- Acceptance: project/admin provenance, inventory and cap validation, settlement/claim/refund coverage, clear custody and cancellation disclosures.
- Dependency: decide whether automated LP creation/locking, vesting, whitelist or permissionless listing is actually required.

### LEND-01 — enable a verified lending market

- Priority: P1. Owner: protocol integration + frontend.
- Deliverable: real supply/withdraw positions; borrowing/repayment only after risk prerequisites.
- Acceptance: section 10 integration evidence, reserve/oracle failure states, health-factor/liquidation UX where relevant, actual position reconciliation.
- Dependency: verified suitable Arc market. Remains blocked otherwise.

### XP-01 — replace demo XP with a verified ledger

- Priority: P2. Owner: backend + product.
- Deliverable: wallet authentication, receipt-derived event ledger, abuse controls and explicit policy.
- Acceptance: duplicate/replay/self-trade tests, caps/cooldowns, reconciliation, audit trail, no points on failed transactions, privacy and terms.
- Dependency: DATA-01, reliable TX-01 outcomes, and approved points policy.

### QA-01 — production validation and operating review

- Priority: release gate. Owner: QA/security/operations + product.
- Deliverable: browser/mobile-wallet/accessibility matrix, monitoring, incident runbooks, independent review and explicit release sign-off.
- Acceptance: all relevant gates evidenced; known risks disclosed; production credentials/admin rights approved; no real-funds enablement by an unreviewed code change.

P0/P1/P2 indicate urgency, not completion estimates or promises. Reorder with an explicit owner decision when dependencies or available protocols change.

## 14. Implementation milestones

| Milestone                               | Scope                         | Exit criteria                                                                                     |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| M1 — approved testnet UX                | UX-01 + TX-01                 | Owner-approved states; reliable submission/recovery; honest feature boundaries                    |
| M2 — public testnet beta                | SEC-01 + OPS-01               | Verified deployment records, reviewed testnet risks, actual HTTPS host and monitored proxy routes |
| M3 — connected trading/account terminal | SWAP-01 + DATA-01 + LAUNCH-01 | Supported liquidity, authoritative account data, defined launch model                             |
| M4 — lending and progression            | LEND-01 + XP-01               | Verified market/risk data and receipt-derived points policy                                       |
| M5 — real-funds release consideration   | QA-01 plus applicable gates   | Independent security/operational evidence and explicit owner sign-off                             |

Milestones are planning checkpoints. Mainnet is not an automatic next step after a testnet UI works.

## 15. Development, validation, and operations

### Start and inspect

```sh
pnpm install --frozen-lockfile
pnpm dev
# http://localhost:5191

pnpm build
pnpm preview
```

Node 22+ and pnpm 11 are the current baseline. Strict development port selection prevents silently serving a different URL when the port is occupied.

### Local validation

```sh
pnpm contracts:check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
# Alternative when a system browser is installed:
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e

git diff --check
```

At the implementation baseline, the last recorded runs passed **52 unit/local-EVM tests and 12 browser tests**. This count will change with future work and does not establish audited safety. Wallet browser tests are mocked; the earlier onchain smoke evidence is recorded separately in the manifest.

Ganache's native µWS fallback warning on Node 22 is known; tests use its JavaScript fallback. Do not mistake that warning for a proven contract failure.

### Read-only operational checks

```sh
pnpm wallet:status
pnpm smoke:testnet
curl http://localhost:5191/api/arc-rpc \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# Expected chain result: 0x4cef52
```

### Commands that broadcast

```sh
pnpm deploy:testnet --broadcast
pnpm smoke:testnet --broadcast
```

These spend testnet gas. Default deployment gas budget is 5 native testnet USDC; smoke budget is 0.2. Existing completed deployments/smoke records must be inspected before rerunning. Partial broadcasts can require manual reconciliation. Do not delete manifests, regenerate wallets, change sale schedules, increase budgets, or send new transactions merely to refresh documentation or screenshots.

### Hosting package

```sh
docker build -t orbit-terminal .
docker run --rm -p 8080:8080 orbit-terminal
```

Use an actual Docker-capable host for validation. Configure public HTTPS/TLS/HSTS at the reverse proxy. Static hosting must implement the documented RPC routes. No public deployment has been established solely by adding these files.

## 16. Definition of done

### Every code update

- [ ] Requested scope and explicit exclusions recorded.
- [ ] Existing working behavior preserved or intentionally migrated.
- [ ] User-facing success, empty/loading and failure states implemented.
- [ ] No demo data leaks into live transaction construction.
- [ ] No private keys, passwords or sensitive wallet data leak into code/logs/screenshots.
- [ ] Relevant unit/EVM/browser tests run; failures disclosed, not hidden.
- [ ] Build and diff checks pass.
- [ ] Visual changes reviewed at mobile/desktop widths.
- [ ] No automatic approval/swap or accidental change to chain, allowlist, amount, recipient or budget.
- [ ] Documentation and update log reflect reality.
- [ ] Working milestone committed with meaningful description.

### Deployment/integration update

Additionally: chain/source/version evidence, constructor/admin details, manifest consistency, correct decimals/native handling, actual controlled testnet receipts where authorized, recovery procedure, and no unauthorized broadcast.

### Production release

Additionally: independent security review, applicable gates closed with evidence, monitored public infrastructure, reviewed key/admin custody, real protocol/data correctness, accessibility/mobile-wallet validation, incident response, terms/privacy/risk disclosures, and explicit owner approval.

Do not use the per-update checklist as a substitute for the production-release checklist.

## 17. Future-update request templates

### General implementation request

```text
Read docs/PROJECT_REFERENCE.md and the specialist docs for this task.

Update ID / area:
Goal:
Current problem / reproduction:
Expected behavior:
Reference screenshot or URL (if visual):
Allowed scope:
Explicit exclusions:
Acceptance criteria:
Deployment/broadcast authorization and budget (if any):

Preserve testnet-only safeguards and the compact live UI.
Do not use demo fixtures as live data or call the result production-ready
without release evidence. Inspect the working tree before modifying it.
Run relevant validation, update documentation, and commit a working milestone.
```

### Visual refinement request

```text
Use docs/PROJECT_REFERENCE.md section 4 and UX-01 as the baseline.
Change only: [screen/component].
Use this reference: [screenshot/URL].
Keep: [approved interactions/layout/colors].
Remove or improve: [specific issues].
Show desktop/mobile states and failure states before expanding the redesign.
Do not change contracts or broadcast transactions for visual work.
```

### Protocol integration request

```text
Implement [SWAP-01 / LEND-01 / LAUNCH-01] for this verified deployment:
Protocol and official registry:
Chain ID:
Contract addresses / ABI version:
Supported assets / decimals:
Oracle/risk/admin information (if applicable):
Authorized testnet account, maximum gas budget, and permitted transactions:

Verify the evidence first. If the protocol/market is unavailable, report the
blocker rather than copying a contract and pretending it is a live integration.
Keep signing in the user's wallet and update manifests/tests/runbooks.
```

### Production-readiness request

```text
Read docs/PROJECT_REFERENCE.md section 12 and docs/RELEASE.md.
Close only these gates: [IDs/gates].
Supplied prerequisites: [host/domain, verified market, review report, policies].
Required evidence: [tests, hosted checks, review findings, deployment records].

Report implemented, blocked, and unvalidated items separately.
Do not relabel the testnet preview as production or enable real funds just
because build/tests pass.
```

## 18. Document maintenance and decision log

### Update procedure

For each meaningful update:

1. Update the status/backlog entries affected by the change.
2. Update specialist documents rather than duplicating conflicting instructions.
3. Append an update record with scope, evidence, limitations and next steps.
4. Keep deployment values linked to the manifest; query live values when needed.
5. Mark proposals as proposals until implemented and validated.
6. Record owner approval explicitly; absence of objection is not design/security approval.

### Update record template

```text
Date:
Update ID / milestone:
Commit / PR:
Requested change:
Implemented behavior:
Changed files:
Validation / evidence:
Onchain transactions and budget used (if any):
Known limitations / blockers:
Owner decision or approval:
Next recommended update:
```

### Recorded decisions and history

| Reference            | Decision / result                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Original brief       | Arc terminal: swap, launchpad, lending, simple Sushi/Aave/Jumper-inspired UX, regular-trader XP                                  |
| `fd0e80f`, `ed865df` | Initial virtual workspace, wallet support, adapters and experimental sale scaffold                                               |
| `a62f63d`, `42f8db9` | Testnet AMM/sale deployment, live transaction UI, hosting package                                                                |
| `d8b906b`            | Same-origin RPC recovery and earlier two-pane redesign                                                                           |
| Owner feedback       | Earlier pages were not clean enough and were not production-ready                                                                |
| `76779d5`            | Compact live swap, separate scoped demo, better pending/unknown confirmation handling, local activity and explicit release gates |
| Current handoff      | This document is the central reference for future updates; no production approval or public hosting approval recorded            |
| 2026-10-02 release   | Owner asked for a FOMO-style app, working router/lending and testnet deployments from the env wallet. Added OrbitLaunch, deployed Morpho Blue/IRM/oracle/market, rebuilt the UI (dark launch terminal), removed the demo workspace, added mainnet network config (no mainnet deploy). Testnet gas for this phase: ~0.31 USDC. Live UI e2e signed launch/buy/sell, faucet/swap and the full Morpho borrow cycle on testnet. |

### Decisions still needed from the owner

- Approved visual references and screen states.
- Target release: public testnet beta first, or a separately reviewed real-funds plan.
- Hosting provider, domain and secure access method.
- Selected verified Arc market/router/lending protocols, if available.
- Launchpad model: sale only versus LP creation/locking, vesting, registry and listing policy.
- Rewards policy and whether points have any non-financial perks.
- Backend/indexer/database/retention requirements.
- Security-review provider and production admin/custody model.

Use these decisions to unblock the roadmap. Do not fill them in with assumptions and then claim the product matches the owner's intent.
