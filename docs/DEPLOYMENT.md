# Production enablement checklist

## 1. Verify the network and deployments

- Select testnet first; compare chain configuration against official Arc docs.
- Source router, pool and token addresses from protocol-owned deployment registries, not arbitrary search results.
- Record chain ID, deployment transaction, implementation address, ABI version, bytecode hash, source verification, owner/admin and upgrade controls.
- The current `verifyDeployment` only confirms bytecode exists; it is **not** an audit or allowlist proof.
- Confirm liquidity/reserves and whether the router is V2-compatible. V3/V4/aggregators require different adapters. Do not call V2 methods against an unknown router.
- Check ERC-20 decimals, native/wrapped semantics, bridges, token risks and supported markets. Fee-on-transfer/rebasing tokens are unsupported.
- Check Aave reserve status, market version, oracle, reserve caps, collateral parameters, interest-rate strategy and user health factor before exposing lending or borrowing.

## 2. Connect live UI deliberately

- Keep fixture quotes and demo balances isolated from calldata. Use `parseUnits`/`formatUnits`, never floating-point math, for actual tokens.
- Fetch balances and allowances by account + chain; invalidate on account/network changes.
- Use fresh onchain or signed aggregator quotes with expiry, route, fees, impact, minimum received and final recipient visible to the user.
- Approvals are a separate user action. Show exact token, spender, allowance and gas; support an explicit zero-reset when needed.
- Revalidate the active account/chain and quote before signing; disable duplicate submits. Track rejection, replacement, revert and finality.
- Re-fetch balances only after successful receipts. Do not award XP on clicks or submitted hashes.
- Add tests against a fork of the actual deployments and a small testnet transaction before wider release.

## 3. Experimental launchpad

`FixedPriceLaunchpad` constructor takes: owner, payment ERC-20, sale ERC-20, start/end timestamps, soft/hard cap **in payment base units**, and rate **in sale base units per payment base unit scaled by 1e18**.

For example, selling 2 tokens with 18 decimals per 1 USDC with 6 decimals requires rate = `2 * 10^30`. Test decimal math independently. Rate is immutable; allocations round down on each contribution.

- Compile with `pnpm contracts:check`; use the resulting ABI/bytecode with your deployment tooling. No private key is included or read by the build.
- Audit before deployment. Test constructor parameters, token behavior, cancellation/admin policy, rounding/dust, front-running, failed raises and liveness.
- Pre-fund the complete hard-cap inventory before the sale starts. Contributions fail if the sale contract does not hold that inventory.
- End of sale (not hard-cap achievement) settles the raise. Successful raises allow claims and one proceeds withdrawal; unsold withdrawal retains outstanding allocations.
- Failed raises allow full payment refunds. Owner cancellation before end allows immediate refunds and closes contributions.
- No automatic LP creation, vesting, whitelist, sale factory, token launch, or permissionless project listing is implemented.
- No arbitrary rescue function; accidental unrelated tokens may be permanently stuck. Standard ERC-20s only; native USDC is not accepted.
- Use a reviewed multisig owner and publish admin/cancellation rights. Verify source and deployment parameters on the explorer.

## 4. XP without wash trading

The browser XP system is intentionally only a demo. Production requires wallet-authenticated sessions, chain-indexed successful receipts, unique chain/transaction/log keys, daily caps/cooldowns, minimum economic activity rules, self-trade/wash-trade filtering and replay protection. Specify privacy/retention policies. Points must never imply guaranteed payouts.

## 5. Release hardening

Self-host fonts, CSP/security headers, RPC fallback/rate limits, telemetry with wallet privacy, malicious-token filtering, accessibility contrast audit, mobile wallet handoff, monitored contract/indexer health, error boundaries, terms and prominent risk disclosures. Keep live execution gated when any integration is unavailable.
