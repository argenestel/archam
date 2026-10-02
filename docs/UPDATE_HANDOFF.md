# Mofu — update log and handoff

> **Read section 12 first.** Sections 2, 6 and 11 describe earlier states. Since then, `main` has advanced to `816c7c5` and **the hackathon deployment went live on Arc mainnet**.

Snapshot: end of this working session. This file records what was actually completed, what was only proposed, and what remains unfinished. **Do not infer deployment, audit, or production readiness from plans or passing tests.**

## 1. Owner decisions and requests

1. Review and rate the existing UI/UX.
2. Replace the launch list with token cards.
3. Store launch logos and wallet-linked public profiles using Pinata/IPFS.
4. Push changes to GitHub; remove the unused GitHub Actions workflow; update `main`.
5. Build a separate Arc mainnet interface collecting available swaps, lending and protocol references.
6. Generate a fresh mainnet deployer wallet, save its private key locally in `.env`, and provide the funding address.
7. Deploy custom launch contracts and restore the launch-first frontend after funding.
8. Clarify that this is a **hackathon**, not a production release: owner accepts an unaudited experimental deployment and wants to avoid mandatory multisig/pre-deployment audit requirements.
9. Rename the public product to **Mofu**, with intended domain **mofu.lol**.
10. Create an SVG logo.
11. Save all progress in this handoff file.

**Important sequencing:** the hackathon deployment mode was proposed, then the owner interrupted for branding/logo changes. **It has not been implemented or broadcast.** The latest request was to save the current state.

## 2. Repository and GitHub state

- Repository: `https://github.com/argenestel/archam`.
- Current local branch: `main`.
- Latest pushed commit on `main`: **`816c7c5`** (was `3d9f216` when this section was written).
- Feature branch `feat/fomo-launch-morpho` was pushed, then fast-forwarded into `main`.
- GitHub Actions workflow `.github/workflows/ci.yml` was removed at the owner's request. Removing it also resolved the previous push rejection caused by the GitHub token lacking workflow permission.
- **Mofu branding changes and `public/mofu-mark.svg` are currently local, uncommitted and unpushed.** This handoff is also newly written locally.
- `.env` is git-ignored and has mode **0600**. No private key was committed or printed.

### Relevant commits

| Commit | Completed milestone |
| --- | --- |
| `ccc6d6c` | Pinata/IPFS logos, signed profiles, launch card grid |
| `ae25e8b` | Remove unused GitHub Actions workflow |
| `f0f8bfb` | Opt-in Arc mainnet protocol hub and guarded SDK execution |
| `3d9f216` | Deployment CLI loads local `.env`; example mainnet deployer configuration |

## 3. UI/UX review

The original running app was reviewed at desktop and mobile sizes:

- Overall **7/10**, UI **8/10**, UX **6/10**.
- Strengths: coherent typography/spacing/colors, clear desktop hierarchy, familiar swap form, explicit lending risk information, no horizontal overflow at the reviewed mobile size.
- Main gaps: mobile hid launch/network/resources, oversized featured card before token browsing, desktop-centric injected-wallet onboarding, crypto terminology, small touch targets, and prominent test data.
- Wallet transactions were not tested as part of that review.

## 4. Launch cards, logos and IPFS profiles — completed

### Frontend

- Responsive token-card grid replaces the launch table/list presentation.
- Cards expose token logo, name/ticker, description, curve progress, market cap and last trade.
- Mobile has a launch action and visible network indicator.
- New launches can upload an optional PNG/JPEG/WebP logo, maximum **2 MB**.
- Uploaded logo URI is stored in the existing launch contract's `image` field as `ipfs://CID`; no contract change was required.
- Existing tokens without a usable IPFS logo retain deterministic fallback avatars.
- Public profile pages: `#/profile/0xADDRESS`.
- Personal profile editor: `#/profile`, reachable through wallet menu/portfolio.
- Profiles support display name, bio, photo, HTTPS website and a link to their IPFS JSON.
- Creator attribution, trade-feed wallet links and leaderboard link to profiles; leaderboard identity can show the public profile name/photo.

### Media backend

- `server/media.mjs` is a separate Node service, default loopback port **5192**.
- Server-only **`PINATA_JWT`** authorizes public Pinata uploads. Never put this credential in a `VITE_*` variable.
- Publishing requires a wallet signature over a short-lived, single-use challenge bound to the action and payload SHA-256 digest.
- Server checks image size/signature and rejects SVG uploads for user-provided token/profile images.
- Profile JSON and photos/logos are public IPFS content.
- A persistent local JSON index maps wallet addresses to the latest profile record/CID: `MEDIA_DATA_DIR/profiles.json`, default `./storage`.
- This is **not an on-chain identity registry**, nor a verified real-world identity system.
- Single-server file storage; use a database for multi-instance production.
- Old IPFS versions may remain accessible. Unused uploads are not automatically unpinned.
- Next.js/nginx proxy `/api/media/` to the media service; nginx CSP permits Pinata gateway images.
- `Dockerfile.media` and `compose.yaml` provide the sidecar and persistent profile volume.
- Live Pinata credentials/uploads were not validated in this session; API tests mock Pinata.

Documentation: `docs/IPFS.md`.

## 5. Arc mainnet protocol hub — completed and pushed

### Separate build/run modes

```sh
pnpm dev:mainnet       # http://localhost:5193, wallet execution enabled
pnpm build:mainnet     # out-mainnet/ static export
pnpm preview:mainnet   # http://localhost:5194
```

Default testnet commands remain available. For read-only mainnet:

```sh
VITE_ARC_NETWORK=mainnet VITE_MAINNET_SIGNING=0 pnpm exec next build
```

A local mainnet development server was started on port 5193 during this session. Check whether it is still running before starting another instance. Nothing was publicly hosted on mofu.lol.

### Verified/discovered data

- Live Arc mainnet RPC returned chain ID **5042**.
- `pnpm verify:mainnet` refreshed `deployments/arc-mainnet.json` and `public/arc-mainnet-deployment.json`.
- Latest recorded verification covered **21 contracts**, **30 Morpho vaults**, and **13 borrowing markets**, with **0 missing checks** at that time.
- Contract checks mean token decimals and/or deployed runtime hashes, **not independent audits, proxy-implementation verification, or guaranteed liquidity**.
- Official Uniswap v4 registry addresses were checked on-chain, including PoolManager, Universal Router, Universal Router 2.1.2, PositionManager, Quoter and StateView.

### Coverage

| Area | Implemented | Limits |
| --- | --- | --- |
| Overview | Network/block check and deployment directory | Snapshots, not every protocol on Arc |
| Swap | Circle App Kit USDC/EURC/cirBTC selection, live estimate, slippage, explicit review | Routes depend on pair/size/liquidity |
| Earn | USDC/EURC Morpho vault discovery, APY/liquidity/warnings, positions, deposit/withdraw quotes | Filtering is not a safety endorsement; withdrawals depend on liquidity/provider |
| Borrow | Market discovery; cirBTC-backed USDC/EURC open/borrow more, repay, add/withdraw collateral, close | Other collateral markets are discovery-only; batch-capable wallet may be required |
| Portfolio | Mainnet asset balances, vault positions, provider-indexed loans, local receipts | Not an authoritative full-chain account index |
| Router directory | Official Uniswap deployments and explorer links | **Not a direct Uniswap routing or liquidity-management integration** |

- No verified Aave adapter is configured.
- Circle decides its swap execution routes; the directory does not make arbitrary router transactions available.
- A **read-only** live quote for **0.123456 USDC → EURC** succeeded with exact six-decimal precision.
- **USDC → cirBTC returned no route** in the read-only check; the UI blocks unavailable routes.
- No real-fund swap, vault deposit/withdrawal or borrowing transaction was executed by this implementation.
- Native USDC (18 decimals) and its ERC-20 interface (6 decimals) are the **same funds**, not separate balances.
- UI retains at least a conservative **0.05 USDC** gas reserve; actual costs vary.

### Transaction improvements

- Removed rounding of SDK input amounts to cents.
- Mainnet writes require the opt-in build flag and explicit user review/wallet authorization.
- Wallet account/chain and RPC chain are checked before SDK execution; signing/submission requests are guarded.
- Success requires a successful on-chain receipt, not an arbitrary hash found in SDK JSON.
- Submission intent is journaled before sending.
- Submitted batch IDs persist after reload and block duplicates until resolved.
- Provider failure without an identifier retains an `unidentified-submission` lock for manual investigation.
- Explicit wallet rejection/unsupported-method errors clear the corresponding unsent intent.
- UI supports **Check receipt** / **Check wallet batch**.
- No automatic force-unlock for uncertain submissions.
- Multitab coordination, replacements/cancellations, wallet variants and adversarial real-fund testing remain incomplete.

Documentation: `docs/MAINNET_APP.md`, `docs/MAINNET_PLAN.md`, `docs/RELEASE.md`.

## 6. Mainnet deployer and funding — prepared, no deployment

**Public deployer address:**

```text
0x9dF0F47ce262930a0370945A78596d3F6957f822
```

- Network: **Arc mainnet, chain 5042**.
- Fresh private key saved locally in `.env` as **`MAINNET_DEPLOYER_PRIVATE_KEY`**.
- Public address saved as **`MAINNET_DEPLOYER_ADDRESS`**.
- Not the testnet deployer.
- Private key was never printed, copied into this document, or committed.
- Last on-chain check after owner funding: **2 USDC**, transaction nonce **0**.
- That address is a **wallet**, not a deployed launch contract.
- Deployment plan's rough gas estimate at the checked price: **~0.2522 USDC**, not a guarantee.
- No custom mainnet contracts have been deployed. **No mainnet transaction has been broadcast by this session.**

### Existing deployment script

`pnpm deploy:mainnet` now loads the local `.env`. It remains a plan-only command unless all its existing gates pass:

- Deployed Safe `MAINNET_MULTISIG`.
- Fresh mainnet deployer key.
- Genuine audit report `ORBIT_AUDIT_REPORT`.
- Matching audited source hash `ORBIT_AUDITED_SOURCE_HASH`.
- Explicit confirmation and `--broadcast`.

Last plan check stopped without broadcasting because Safe/audit/confirmation gates were unset. No audit fields were fabricated.

Current launch/token source hash reported by the plan:

```text
0xc7edd0304a06f77adb1f7f13d030293ee3bcf3c01cefe2582f7f851dc81b1cce
```

This identifies source; it **does not mean the source is audited**.

### Owner-approved hackathon direction — superseded: implemented and deployed (see section 12)

The owner clarified that they want an experimental hackathon deployment with auditing performed as development continues. Proposed implementation:

1. Explicit separate `--hackathon` mode; keep the normal production gates intact.
2. Use the funded deployer as single-wallet owner and fee recipient instead of requiring a Safe.
3. Record the release as **unaudited/experimental**; never create a fake audit report/hash attestation.
4. Enforce a pre-submission gas budget and save each transaction/address immediately for recovery/resume.
5. Deploy canonical V2 factory/router plus the existing launch contract.
6. Decide/explicitly implement public launch enablement and owner controls.
7. Verify code/constructor state/receipts; persist actual mainnet deployment records.
8. Wire the frontend to those actual mainnet records and restore the launch-first homepage/cards.

**None of these hackathon-mode deployment steps were executed before the owner paused for the Mofu rename.**

### Frontend wiring still needed after deployment

- `src/lib/contracts.ts` currently selects Orbit-operated contracts from the testnet manifest only; mainnet custom contracts stay disabled even if an `orbit` deployment record is later added.
- Mainnet homepage currently shows the protocol hub, not Discover.
- To restore launches, connect mainnet launch/router/config/runtime hashes to actual records while keeping testnet lending/test tokens isolated.
- Respect live `launchesPaused` state and signing flags; do not use a stale manifest to imply launch availability.
- Update swap routing for graduated tokens without falsely exposing testnet pool assets on mainnet.
- Existing custom deployment script records the final manifest only at the end; improve durable receipt/partial-deployment recovery before sending transactions.
- `verify-mainnet.mjs` presently rebuilds the ecosystem manifest; ensure it preserves future custom deployment records rather than erasing them.

## 7. Mofu rebrand — local, partly completed

Public product name: **Mofu**. Intended domain: **https://mofu.lol**.

### Changed locally

- Header brand and accessible home-link name.
- Mainnet/borrow/lending/portfolio/token/risk/error/wallet explanatory text.
- Pool venue label changed to Mofu pools.
- Backend media authorization/API labels changed to Mofu.
- Browser page title/description changed to Mofu; canonical URL added for mofu.lol.
- Nginx `server_name` set to `mofu.lol www.mofu.lol`.
- README/project reference/IPFS/mainnet notes updated with branding status.
- Legal privacy/terms **drafts** rewritten for Mofu and current public IPFS/profile handling. They are not legal approval.
- Mainnet browser test's home-link assertion updated to `Mofu home`.

### Deliberately retained

- Historical deployed Solidity artifact names such as `OrbitLaunch` / `OrbitToken`. **Update:** current source names are now `MofuLaunch` / `MofuToken` / `MofuTestnetOracle`; see section 11.
- Existing immutable on-chain token names and historical deployment records.
- Legacy `orbit:*` events, browser storage keys and CSS identifiers for compatibility.
- Legacy package name `arc-terminal` and existing GitHub repository.

### Domain status

Setting nginx names and a canonical URL **does not** register/verify the domain, configure DNS, provision a public host, issue TLS certificates or deploy the website. These remain undone. No DNS/provider credentials were supplied.

### Brand assets — partial

- **Created:** `public/mofu-mark.svg` — a standalone, accessible vector mascot with fluffy rounded blue outline, ears and a friendly M-shaped face.
- Header already references `/mofu-mark.svg`.
- **Not yet created:** `public/mofu.svg` favicon, although `index.html` now references that path. Fix this before publishing; the favicon currently references a missing file.
- **Not yet created:** full SVG wordmark/lockup (proposed `public/mofu-logo.svg`).
- Old `public/orbit.svg` / `public/orbit-mark.svg` still exist.
- The new mascot was written, but final visual review and post-rebrand tests/builds have **not** run.
- A running Node media process must be restarted to pick up its new branding; the Next.js development server normally hot-reloads frontend changes.

## 8. Validation evidence

Last fully validated and pushed mainnet protocol-hub milestone, **before the local Mofu rebrand**:

- Testnet production build: passed.
- Mainnet production build: passed.
- **44** unit/contract/API tests: passed.
- **8** mainnet browser checks: passed (read-only live discovery/quotes plus fully mocked batch, rejection and unknown-submission recovery).
- **9** testnet/media browser checks: passed.
- No horizontal overflow across reviewed mobile/tablet/desktop widths.
- Docker composition configuration validation: passed using a placeholder Pinata value, **not** a live credential.
- Full container runtime validation was not possible because no working Docker daemon was available.
- Pinata live uploads, public hosting/TLS, real-fund protocol transactions and custom mainnet deployment remain unvalidated.

These results are **not** post-rebrand results and **not** an audit.

## 9. Recommended next steps

1. Finish `public/mofu.svg` and the full SVG wordmark; visually review at favicon/header sizes.
2. Finish remaining public documentation branding where needed; preserve legacy technical identifiers unless deliberately migrated.
3. Run both builds and existing tests after branding, then commit/push the rebrand and this handoff.
4. Resume the owner's explicit hackathon deployment request: add a separate experimental mode, durable recovery and a gas cap; do not falsify audit status.
5. Confirm the deployer still holds funds and inspect nonce/receipts before any transaction; never redeploy blindly after an uncertain result.
6. Deploy only the intended contracts, record actual addresses/receipts/owner/fees/paused state, and wire mainnet launch UI accordingly.
7. Configure server-only Pinata credentials if logos/profiles are needed live; never embed them in the frontend.
8. Provision mofu.lol DNS/hosting/HTTPS with owner-supplied infrastructure, then validate RPC/CSP/media routes on that host.

## 10. Useful commands

```sh
# Existing local modes
pnpm dev
pnpm media
pnpm dev:mainnet

# Builds and tests
pnpm build
pnpm build:mainnet
pnpm test
pnpm exec playwright test e2e/app.spec.ts e2e/media.spec.ts
ORBIT_MAINNET_E2E=1 pnpm test:e2e

# Read-only checks / existing production-gated plan
pnpm verify:mainnet
pnpm deploy:mainnet

# Hosting configurations (Pinata sidecar requires server-side PINATA_JWT)
docker compose up --build -d
docker compose -p orbit-mainnet -f compose.yaml -f compose.mainnet.yaml up --build -d
```

**Before a custom deployment exists, `verify:mainnet` is read-only and refreshes snapshots. After deploying, fix its manifest-preservation behavior before running it.**

Do not dump `.env`, include private keys in logs/screenshots, commit secrets, or claim that deploying for a hackathon makes real funds risk-free.

## 11. Contract rename and internal audit — 2026-10-02 update

The owner subsequently requested a contract audit/report and asked to rename the contracts as well.

- Renamed current sources to **`MofuLaunch.sol`**, **`MofuToken.sol`**, **`MofuTestnetOracle.sol`**, including declarations/imports, compiler lookups, test files and new deployment labels.
- Updated testnet deployment/oracle-refresh/frontend lookups to reuse legacy manifest records. No historical manifests, deployed addresses or runtime hashes were relabeled, and no contract was redeployed merely for branding.
- `FixedPriceLaunchpad`, `TestnetToken` and upstream dependency names remain generic/upstream. Existing `deploy:orbit` CLI and legacy audit environment names remain compatible.
- Comparing original and renamed ABIs with the same compiler confirmed all three externally encoded interfaces remain equivalent (normalizing internal type names). Source/metadata/bytecode fingerprints change.
- Internal review report: **`docs/CONTRACT_AUDIT.md`**. It is not independent certification and must not satisfy production audit attestations.
- Findings remain **open**: 3 Medium deployment-safety issues (non-atomic initial pause, missing durable recovery/manifest preservation, post-spend gas cap) and 4 Low findings (supply disclosure, donation-sensitive bootstrap price, build provenance, unbounded portfolio read).
- Added **6** evidence tests in `contracts/test/MofuLaunch.audit.t.sol`. These reproduce findings/assumptions; they are not fixes.
- Validation after renaming: **19 Foundry tests**, **44 unit/contract/API tests**, both builds, changed script syntax and whitespace checks passed. Foundry compiler is 0.8.30; actual npm/deployment compiler is 0.8.37, documented in the report. No Slither or new browser test run.
- Current launch/token source hash: **`0x0faacc15c2a9fd9be90c0a4cd50aa4e365b4db7206e48a86cb20e05d7dc8ba89`**. The earlier Orbit hash in section 6 is historical and obsolete for the renamed source.
- No `.env` audit fields were set; no mainnet transaction was broadcast. Hackathon deployment and launch-first mainnet wiring remain unfinished.
- Contract rename/audit changes were committed and pushed to `main` as **`770327d`**, separately from the still-local frontend/server branding. The missing `/mofu.svg` favicon and unfinished wordmark remain unresolved even though builds succeed; build success does not check that asset reference.

## 12. Verified state — 2026-10-02 (latest)

Checked against `git`, the working tree and Arc mainnet RPC. Nothing below was changed by this check except documentation.

### Git

- `main` = `origin/main` = **`816c7c5`** (“Tidy audit report and record published contract rename”). Commits since `0a71787`: `ccc6d6c` IPFS/profiles/cards, `ae25e8b` CI workflow removed, `f0f8bfb` mainnet protocol hub, `3d9f216` deployer `.env` loading, `770327d` Mofu rename + internal review, `816c7c5` audit tidy.
- Branch `feat/fomo-launch-morpho` stops at `ae25e8b` and is fully contained in `main`.
- **Uncommitted working tree (29 modified + 4 new files)** holds the hackathon release: `scripts/deploy-hackathon.mjs`, `scripts/lib/deployment-journal.mjs`, `contracts/deployment.test.js`, `MofuLaunch.sol` changes (paused at construction, corrected `TOTAL_SUPPLY`), the updated mainnet manifests, `public/mofu-mark.svg` and the remaining rebrand edits.

### Mainnet (hackathon mode), verified on-chain

- UniswapV2Factory `0x58498B4267D7479d6A5E14a8342ce18e08997378`, UniswapV2Router02 `0xe7a42B28f488543a11A75194D44ddC54859D1779` (`factory()` matches), **MofuLaunch `0xB583aD345d9261F267D6966f2D965C40E25e5cb4`**. Runtime hashes match the manifest.
- All four transactions succeeded: three deploys plus “Enable launches” (blocks 23875539–23875636).
- Owner and fee recipient: deployer EOA `0x9dF0F47ce262930a0370945A78596d3F6957f822`. Launches open, 0 tokens launched, virtual reserve 5,000 USDC, fee 100 bps. Deployer balance ≈1.53 USDC, nonce 4.
- Unaudited. The internal review statuses are updated in `CONTRACT_AUDIT.md` (M-01/M-03/L-01 fixed, M-02 fixed for this path, L-02/L-04 open).

### Validation on the current working tree

- Testnet and mainnet production builds: pass.
- `pnpm test`: **57 passed**. `forge test`: **19 passed** (6 audit-evidence + 8 unit/fuzz + 5 invariants).
- Not re-run in this check: browser e2e suites.

### Gaps to close next (in order)

1. **Commit and push the working tree.** Mainnet bytecode currently comes from uncommitted source, so `main` cannot reproduce it.
2. **Wire the mainnet frontend to the deployment.** `src/lib/contracts.ts` still disables Mofu launches on mainnet (comment: “Mainnet has no Mofu deployment yet”), and the footer says launches are disabled. Read `deployments/arc-mainnet.json` → `launch` / `mofu.contracts`, respect live `launchesPaused`, and restore the launch-first homepage.
3. Graduated-token swaps on mainnet through the new router.
4. Create `public/mofu.svg`. `index.html` references it; it's still missing.
5. Explorer source verification for the three contracts; a decision on moving ownership to a Safe.
6. mofu.lol DNS/hosting/TLS; server-side `PINATA_JWT` for live logos/profiles.
7. Keep `storage/mainnet-deployment.json` (git-ignored; signed transactions) backed up privately; it is the recovery journal.
