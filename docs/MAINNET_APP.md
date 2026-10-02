# Mainnet protocol hub (opt-in beta)

This version aggregates existing Arc mainnet protocols. It does **not** deploy or enable Orbit's unaudited token-launch or lending contracts. It is a beta for deliberate, wallet-approved testing, not an audited production release or a guarantee against loss.

## Run separately from testnet

```sh
pnpm dev:mainnet       # http://localhost:5193 — chain 5042, wallet execution enabled
pnpm build:mainnet     # dedicated dist-mainnet/ output, same opt-in signing flags
pnpm preview:mainnet   # http://localhost:5194
```

Default `pnpm dev` / `pnpm build` still target testnet. For a read-only mainnet build:

```sh
VITE_ARC_NETWORK=mainnet VITE_MAINNET_SIGNING=0 pnpm exec vite build --outDir dist-mainnet
```

No wallet key is stored by the frontend. Fund **your own wallet on Arc chain 5042**, not an Orbit, router, vault, or contract address. Keep at least 0.05 USDC unspent as a conservative gas reserve; actual gas costs vary. Start with a small amount only after reviewing the selected third-party protocol and your wallet's transaction details. There is no Orbit deposit address. Do not send a private key to anyone.

## Coverage and limitations

- **Overview:** current chain/block check and a committed deployment directory with explorer links and source provenance.
- **Swap:** Circle App Kit same-chain USDC/EURC/cirBTC selection. Requires a live quote, preserves token precision, applies selected slippage to estimate and execution, and explicitly reviews before wallet signing. Route support is amount- and liquidity-dependent. Read-only verification obtained a USDC → EURC quote for 0.123456 USDC; USDC → cirBTC returned no route. No mainnet swap has been executed by this update.
- **Earn:** provider-discovered USDC/EURC Morpho vaults, variable APY, liquidity, warnings, wallet positions, deposit and withdrawal quotes. Default filters are not a safety endorsement. All discovered stablecoin vaults can be shown, and known positions remain visible even if a vault no longer passes filters. Vault bytecode/underlying asset are checked before a write; known mainnet vault hashes must match the manifest. Withdrawals remain subject to protocol liquidity and provider availability. Assets and shares may have different precision; displayed APY is not a promise of return.
- **Borrow:** provider-discovered markets, including discovery-only assets. Execution is limited to known cirBTC collateral with USDC/EURC loans: open/borrow more, repay, add collateral, withdraw collateral with service-sized repayment, and close. Quote review includes collateral pulled/released, repayment ceiling, health factor, fees, and liquidation price. New borrow/withdraw is refused if the quoted health factor is unavailable or below 1.1; 1.1 is a minimum guard, **not a safe target**. Loan history only covers Circle-indexed loans. Batch-capable wallet support may be required; SDK errors are not bypassed.
- **Directory:** Uniswap v4 PoolManager, Universal Router, Universal Router 2.1.2, Quoter, StateView and PositionManager have on-chain code/hash checks from the official Uniswap registry. They are reference entries, **not direct Uniswap swap or LP integrations**. Circle decides its swap routes. No verified Aave adapter is configured. Discovery is not an exhaustive list of every protocol deployed on Arc.
- **Portfolio:** wallet assets, provider-discovered vault positions/loans, and local transaction history. Native USDC and its ERC-20 balance are the same funds viewed at 18 and 6 decimals, not two separate balances.

Orbit launch, leaderboard rewards, test faucets, and the Orbit-owned testnet Morpho market are not enabled on mainnet. The existing custom-contract deployment/audit gates are unchanged.

## Confirmation and recovery

SDK flows guard wallet account/chain before signing and record submitted transaction hashes. Success requires an actual successful on-chain receipt, not finding a hash somewhere in SDK output. Submission intent is persisted before sending; an RPC failure without an identifier preserves an `unidentified-submission` lock for manual investigation. Explicit wallet rejection/unsupported method errors clear that intent. Submitted wallet batch IDs are persisted separately and block another operation until resolved. Reconnect the original wallet/network and use **Check wallet batch** (`wallet_getCallsStatus`) or **Check receipt**. Do not repeat an uncertain operation. Providers without batch status support require manual wallet/provider investigation; there is deliberately no automatic force-unlock.

The SDK obtains fresh execution quotes, so displayed quotes are estimates rather than signed transaction envelopes. Review final wallet requests. Mainnet execution, replacement/cancellation, provider failure after submission without an identifier, multi-tab coordination, hardware wallets, and all batch-wallet variants still need adversarial/manual testing. Do not treat these guards as production certification. Protect browser storage; it is a convenience recovery journal, not an authoritative index.

## Hosting

```sh
# Pinata is optional for trading but required by this composition's media sidecar.
# Set PINATA_JWT only on the server, then:
docker compose -p orbit-mainnet -f compose.yaml -f compose.mainnet.yaml up --build -d
```

Use HTTPS at the public reverse proxy. The nginx CSP allows Circle API and official Arc RPC connections used by the SDK, plus Pinata images. This build reads `.env` server-side/build-time; no private key or Circle/Pinata API secret belongs in a `VITE_*` variable. Circle discovery availability and public API quotas can affect UX. No fee is configured by Orbit; protocol/provider fees still apply.

The Docker composition has configuration validation only until a Docker daemon is available for full container validation. Domain/TLS, monitoring, security review, legal review, and the independent custom-contract audit remain open gates.

## Verify (no transactions)

```sh
pnpm verify:mainnet             # refresh manifests from live chain + Circle discovery
pnpm test
ORBIT_MAINNET_E2E=1 pnpm test:e2e # read-only live layout/discovery/quotes + entirely mocked batch/rejection/recovery tests
```

`deployments/arc-mainnet.json` and `public/arc-mainnet-deployment.json` are snapshots, not guarantees of current liquidity or protocol authenticity. `verify:mainnet` checks token decimals and deployed code hashes, lists current markets, and reports missing checks. It does not audit proxy implementations or prove a route for every pair. Independent source verification and security review remain necessary before a production release.
