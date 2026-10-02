# Mofu contracts — internal security review

**Date:** 2026-10-02  
**Reviewer:** AI-assisted internal review, not an independent audit firm  
**Baseline:** `3d9f21649cd10abb411cccfa3f9d959fc84b497d`, plus the Mofu contract rename described below  
**Status:** Review complete; findings remain open. No contracts deployed or mainnet transactions broadcast as part of this review.


## Executive summary

No Critical or High severity issue was identified within the reviewed scope and assumptions. **Three Medium deployment-safety findings and four Low findings** were identified. This does not establish the absence of exploitable vulnerabilities.

The standard-token curve accounting, fee separation, seller authorization, slippage/deadline checks, fixed-price escrow settlement and restricted launch-token transfers appear consistent with their intended design under local testing. The deployment process does not yet provide a reliably paused, recoverable, budget-bounded mainnet rollout.

The sources are now `MofuLaunch`, `MofuToken` and `MofuTestnetOracle`. Their externally encoded ABIs remain equivalent to the original Orbit versions; source paths, artifact names, metadata, bytecode and source hashes change. Renaming sources does **not** rename deployed contracts, migrate their state, or verify their deployed bytecode. Historical manifests remain untouched; testnet tooling reuses legacy records instead of automatically redeploying for the rename. Generic `FixedPriceLaunchpad` and `TestnetToken`, and upstream Uniswap/Morpho names, are unchanged.

## Scope and methodology

### Direct contract review

- `contracts/src/MofuLaunch.sol`: launch, buy/sell, rounding, graduation, quote/fee accounting, owner powers and read APIs.
- `contracts/src/MofuToken.sol`: fixed supply, transfer lock, approval-free seller pull and graduation.
- `contracts/src/FixedPriceLaunchpad.sol`: inventory, contributions, success/failure/cancellation, refunds, claims and owner withdrawals.
- `contracts/src/MofuTestnetOracle.sol`: authorization, freshness and chain restrictions.
- `contracts/src/TestnetToken.sol`: chain restrictions, decimals and faucet behavior.

### Supporting operational review

- `scripts/deploy-mainnet.mjs`, `scripts/verify-mainnet.mjs`, `scripts/check-contracts.mjs`, `foundry.toml`.
- Rename compatibility in `scripts/deploy-orbit.mjs`, `scripts/oracle-refresh.mjs` and `src/lib/contracts.ts`.
- Existing local contract integration tests and Foundry handler/invariants; six new adversarial evidence tests.

Manual source inspection, local EVM execution against canonical V2 artifacts, bounded fuzz/invariant tests, dependency/compiler inspection and an old/new ABI comparison were performed. Production deployment tooling was inspected, **not broadcast**. Findings concerning script interruption, persistence and budgets are source-inspection findings, not live fault-injection results.

### Assumptions and exclusions

- Quote/payment/sale assets are correctly configured, standard non-rebasing, non-fee ERC-20s. The launch quote and V2 factory/router are trusted immutable dependencies. Unsupported assets can invalidate accounting; see the evidence test below.
- Private keys and the deployment machine are not compromised. Metadata strings are untrusted display content, not Solidity execution.
- Upstream Uniswap V2, vendored Morpho Blue/IRM and OpenZeppelin were exercised as dependencies, **not independently re-audited**. The frontend, media/Pinata service, Circle SDK and externally operated mainnet vaults/markets are outside this contract audit.
- No mainnet fork, Arc native/ERC-20 USDC equivalence test, live blocklist test, explorer verification, gas stress benchmark, formal proof or comprehensive MEV analysis was performed. Local quote assets are ordinary ERC-20 mocks, not Arc's system interface.
- Slither was unavailable. No static-analysis clean bill of health is claimed.

## Findings

| ID | Severity | Area | Finding | Status |
| --- | --- | --- | --- | --- |
| M-01 | Medium | Rollout | Launches start open before the separate pause transaction | Open |
| M-02 | Medium | Operations | Partial deployment is not durably journaled; discovery can erase records | Open |
| M-03 | Medium | Operations | Gas cap is checked after spending, not enforced before submission | Open |
| L-01 | Low | Tokenomics | Advertised supply differs from actual minted supply | Open |
| L-02 | Low | Graduation | Quote donations can materially change initial AMM price | Open |
| L-03 | Low | Build provenance | Test/deploy compiler mismatch and incomplete source attestation | Open |
| L-04 | Low | Read API | Unbounded `positionsOf` can exceed practical RPC limits | Open |

Severity reflects realistic impact under the stated assumptions. Operational findings are not claims of an on-chain principal-stealing exploit.

### M-01 — non-atomic paused rollout

**Locations:** `MofuLaunch.sol` constructor and `launchesPaused`; `deploy-mainnet.mjs` deployment followed by `setLaunchesPaused(true)`.

The default boolean is false. After the launch deployment is confirmed but before the pause transaction is mined, anyone can create a curve. If the process fails before pausing, the window persists indefinitely. Later pausing only blocks new launches; previously created curves remain tradeable and can graduate. Thus the script's stated paused-rollout guarantee is not atomic.

**Evidence:** `test_auditDeploymentStartsOpenAndPauseDoesNotDisableExistingCurves` creates a curve as a non-owner before pause and successfully buys afterward.

**Recommendation:** Make initial pause state explicit in the constructor, or deploy and pause atomically through a reviewed factory. For a deliberately open hackathon deployment, explicitly record that activation policy rather than describing it as paused. Verify live pause/owner state before announcing availability. Adapting this requires updating tests and deployment flows; this review does not silently change the constructor policy.

### M-02 — deployment/recovery record loss

**Locations:** `deploy-mainnet.mjs` `send`, `deploy`, final manifest write; `verify-mainnet.mjs` final snapshot writes.

Transaction hashes, receipts and addresses live only in memory until all deployments and administrative calls finish. A receipt timeout, process termination, RPC failure or post-spend budget exception can leave successful deployments unrecorded. The script has no durable pending-intent journal or resume/reconciliation logic; retrying can deploy duplicates and leave the first launch contract in an unintended state. Running mainnet discovery later rebuilds and overwrites the manifest, discarding future custom `orbit`/`launch` records. Public custom deployment records are also not synchronized by the deployment script.

**Recommendation:** Atomically journal intent/chain/account/nonce before submission, persist the hash immediately and every receipt/address/constructor configuration afterward. Treat unknown submission as requiring reconciliation, not permission to retry. Add idempotent resume with receipt/code/state checks and preserve custom records during ecosystem discovery. Keep archival deployment history separate from replaceable discovery snapshots.

### M-03 — post-spend gas cap

**Location:** `deploy-mainnet.mjs` `send`.

`spent` is updated only after a transaction receipt, then compared with `maxGasUsdc`. The transaction that exceeds the cap has already spent funds; its hash is not even appended to the in-memory record before the exception. The plan uses a byte-length heuristic and a single gas-price snapshot, not a transaction-level spending bound. Fee changes or an underestimated transaction can exceed the operator's intended budget and interrupt pause/ownership setup.

**Recommendation:** Estimate/simulate each exact transaction, apply a conservative gas limit, bound its gas price/max fee, and reject before signing when worst-case cost exceeds the remaining budget. Persist submitted transactions even when a cap check fails. Reserve a bounded budget for required final administrative calls. Document that network execution and failed transactions still consume gas.

### L-01 — supply constant and frontend disagree with mint

**Locations:** `MofuLaunch.sol` `TOTAL_SUPPLY`, constructor `lpSupply` and `launch`; `src/lib/contracts.ts` `launchConfig.totalSupply`.

The advertised constant is 1,000,000,000 tokens, but each launch mints `SALE_SUPPLY + lpSupply`, where LP supply is rounded from the final-price matching formula. Actual initial supply is **999,986,011.183597390493942218** tokens, a difference of **13,988.816402609506057782**. Curve inventory remains internally consistent; this is a disclosure/valuation mismatch, not an excess-mint exploit.

**Evidence:** `test_auditActualSupplyDiffersFromAdvertisedConstant`.

**Recommendation:** Define and disclose the actual supply consistently, or deliberately specify how the difference is minted/burned without changing LP price alignment. Calculate market cap from live `totalSupply()` where practical. Existing deployed tokens cannot be changed by a source rename.

### L-02 — donations affect pool bootstrap price

**Location:** `MofuLaunch.sol` `_graduate`.

Direct pair minting correctly avoids the zero-token-reserve Router02 donation/sync denial of service covered by existing tests. However, anyone can donate quote to a pre-created pair. Its eventual reserves include that donation, so the initial AMM price need not match the final curve price. A sufficiently large donation can change the price materially without violating any buy's `minTokensOut` check.

**Evidence:** `test_auditPairDonationCanMateriallyChangeGraduationPrice`: at the local 20-USDC virtual reserve, a 1,000-USDC pair donation and sync produce a pool price more than twice the final curve price while graduation succeeds.

This costs the donor funds and does not by itself establish profitable theft or insolvency; hence Low severity. The existing small-donation integration test does not bound arbitrary donations.

**Recommendation:** Document that price alignment assumes no quote donation. If strict bootstrap price protection is required, design a donation-aware, permissionless graduation policy and test it against griefing; a simple price-deviation revert can reintroduce permanent graduation denial of service. Do not present curve quotes as guaranteed AMM prices.

### L-03 — build provenance is narrower than the tested artifact

**Locations:** `foundry.toml`, `scripts/check-contracts.mjs`, `package.json`, `deploy-mainnet.mjs` source hash gate.

Foundry uses Solidity **0.8.30**, but the npm `solc` installation actually resolves to **0.8.37**. Deployment uses the npm compiler, so Foundry-only testing would not cover the exact compiler used for deployment. Ganache integration tests did also pass with the npm compiler, reducing but not eliminating this provenance gap.

The audit hash includes only concatenated launch/token source text, not OpenZeppelin imports, compiler version/settings, V2 artifacts or the lockfile. The report gate checks file existence, and the multisig gate checks only deployed code, not whether it is a correctly configured/usable multisig. These are operator acknowledgements, not cryptographic evidence of an independent audit or valid Safe governance.

**Recommendation:** Pin one exact compiler and frozen dependencies, test the release artifact itself, record standard JSON input/compiler/settings/dependency and runtime hashes, and verify constructor state. Verify intended owner capabilities explicitly. Do not reuse this internal report as independent audit certification. The rename invalidates the previous source hash.

### L-04 — unbounded portfolio read

**Location:** `MofuLaunch.sol` `positionsOf`.

The function copies every token a trader has ever traded and performs a `balanceOf` call for each. The array never shrinks. A sufficiently active wallet can exceed provider call gas/response limits and lose this portfolio read path. The wallet must grow its own trade history; no unrelated attacker can cheaply append entries to an arbitrary victim's history under the reviewed design. Trading and custody are unaffected.

**Recommendation:** Add capped pagination or reconstruct portfolio pages from events. Keep the existing view for compatibility only if its practical limitations are documented.

## Design observations and trust boundaries

- **Permissionless fee withdrawal is intentional:** callers cannot choose the destination or withdraw recorded curve principal. `feesAccrued` is zeroed before transferring to `feeRecipient`. Owner can change the recipient and pause new launches, not confiscate live holder balances through a public arbitrary pull.
- **Approval-free selling:** token `pull` is launcher-only; the launch sell path always pulls from `msg.sender`. Public callers cannot nominate another victim. Graduated curves reject launch buy/sell; ordinary token approvals/transfers then apply.
- **Blocklists/asset outages:** a frozen launch/pair account can block trades or graduation. Changing a blocked fee recipient can restore fee withdrawal, but cannot resolve a frozen launch account. There is no trading pause, alternate quote or upgrade/recovery mechanism; this limits both owner intervention and incident recovery.
- **Unsupported quotes:** the constructor accepts generic addresses and does not verify received amounts. `test_auditUnsupportedTaxedQuoteBreaksSolvencyAssumption` demonstrates undercollateralization with a taxed mock. This is outside the documented standard-token assumption, not a demonstrated exploit against correctly configured Arc USDC. Deployers must not infer asset compatibility from successful construction.
- **Unsolicited transfers:** quote donations to the launch contract are surplus, not recorded curve funds or fees, and have no dedicated recovery path. Returning tokens to the launcher does not restore tracked sale inventory; they are burned at graduation. Evidence tests cover both. The existing exact-balance invariants apply only to their buy/sell-only handler; a donation-aware solvency property should use liabilities ≤ balance.
- **Fixed-price escrow:** standard-token test paths preserve refunds after cancellation/failure and unclaimed inventory after successful owner withdrawals. Owner may cancel before sale end; success requires end time and soft cap. Payment balance deltas reject transfer fees, but unsupported sale tokens are still an explicit configuration assumption.
- **Testnet oracle/faucet:** chain guards prevent construction on chain 5042. Oracle owner controls prices, stale reads revert, and one-step ownership can be transferred to zero/unusable addresses. A freely Sybil-mintable faucet and owner/spot-priced oracle are unsuitable for real-value markets even if copied to another chain. Do not remove the guards for mainnet use.
- **Dependencies/governance:** factory `feeToSetter` may enable V2 protocol fees; burning initial LP does not promise zero future protocol LP issuance. Router WETH=USDC in the proposed mainnet plan intentionally leaves native-ETH router paths unusable; it is not a standard wrapped-native integration.

## Validation evidence

| Check | Result |
| --- | --- |
| Existing Foundry suite before rename | 13 passed |
| Final renamed Foundry suite, including 6 audit evidence tests | **19 passed**, 0 failed |
| Invariant settings | 64 runs × 120 depth per invariant; buy/sell-only handler; `fail_on_revert=false` |
| Renamed local unit/contract/API suite (`pnpm test`) | **44 passed**, 11 files |
| Testnet build (`pnpm build`) | Passed |
| Mainnet build (`pnpm build:mainnet`) | Passed |
| ABI comparison using original sources from baseline and current sources under npm compiler | All 3 renamed contract ABIs equivalent after normalizing internal type names |
| Changed deployment/compile scripts syntax checks; `git diff --check` | Passed |

Foundry ordinary fuzz tests use 256 runs. Evidence tests **pass by reproducing current behavior**, not by proving remediation. A passing invariant summary does not imply full adversarial coverage: handlers omit donations, arbitrary tokens, blocked assets, fees/ownership changes and deployment failures; bounded fuzzing is not a proof. Ganache emitted a µWS native-module compatibility warning and successfully used its JavaScript fallback. Browser tests were not rerun for this contract review.

Installed dependencies inspected: OpenZeppelin **5.6.1**, Uniswap V2 core **1.0.1**, periphery **1.1.0-beta.0**. Vendored Morpho commit references are documented in `contracts/vendor/README.md`; provenance assertions there were not independently authenticated in this review.

### Reproduction

```sh
forge test -vv
forge test --match-contract MofuLaunchAuditTest -vv
pnpm test
pnpm build
pnpm build:mainnet
```

The evidence tests are in `contracts/test/MofuLaunch.audit.t.sol`; normal Foundry tests in `contracts/test/MofuLaunch.invariant.t.sol`; npm contract integrations in `contracts/mofu.test.js` and `contracts/launchpad.test.js`.

## Reviewed source fingerprints

SHA-256 hashes of final reviewed files (not audit certifications):

| File | SHA-256 |
| --- | --- |
| `contracts/src/MofuLaunch.sol` | `614e0b8f12c17674598bceaa2e3c70f06d2ba52358fc085fa7a6d2a91b59d683` |
| `contracts/src/MofuToken.sol` | `e8eccea24e342d12fdf115aa00ec97e8cfbd85b27ff409f79a67b75dcc0e7497` |
| `contracts/src/MofuTestnetOracle.sol` | `e3e6eed54ba12405f6cca6437def7590f511460fa30ec3f85adadc7a9400cff7` |
| `contracts/src/FixedPriceLaunchpad.sol` | `a54514486f17652036cc3bc21ed8337870e0641efffe084e3a6d8fe9a3294072` |
| `contracts/src/TestnetToken.sol` | `0aa857a3e21ce5d47e72778d486a0769f47609f68c9f557cc392c46f1512645a` |
| `scripts/deploy-mainnet.mjs` | `58a1a22dbef41c53b2730612d89b534c8d585d8ea928598c5ff92cd2c680d468` |
| `scripts/verify-mainnet.mjs` | `70d8b3d3d01bf0f76b08f456aafeacc9d169a847799814e1bb5e1ee444144240` |
| `scripts/check-contracts.mjs` | `5cf2312b7d8afe2f28b4302249e94b501953aa1026d91ee3d24851c8739e29e4` |
| `foundry.toml` | `836f3692e3f78f36dd65e9cf0047f3881dbc4a2eeb604e8471de7fca72fe726c` |
| `pnpm-lock.yaml` | `111ba8c6ba2771b7c589978e38e7f74a2fb3706be2f26bea1141ba1cb1968f03` |

Launch/token concatenation Keccak-256, as computed by the deployment script:

```text
0x0faacc15c2a9fd9be90c0a4cd50aa4e365b4db7206e48a86cb20e05d7dc8ba89
```

The previous Orbit source hash is obsolete for these sources. No `.env` audit flags were set, no secrets were copied into this report, and no historical runtime hashes were changed to match renamed sources.

## Recommended next actions

1. Fix or explicitly accept M-01 through M-03 before broadcasting a new deployment; preserve recoverable transaction history and confirm live state.
2. Unify/pin release compiler and dependencies; address supply disclosure and read pagination, and document donation/bootstrap-price behavior.
3. Expand adversarial coverage: multiple curves/users with donations and withdrawals, unsupported/reentrant tokens, blocklist behavior, failed graduation, extreme permitted parameters, fixed-price boundary/rounding tests and oracle stale/chain-restriction tests.
4. Test the exact release artifacts against Arc's USDC interface and verify actual constructor/code/owner state after deployment.
5. Keep hackathon labeling separate from an independent production audit. Do not bypass production gates by treating this report as external certification.
