# Release status: testnet preview, not production-ready

This is a deployed testnet prototype with a cleaner user interface. Neither a passing build nor a larger test count establishes that it is safe for real funds.

## Implemented in the current preview

- Allowlisted, runtime-hash-checked Arc testnet token/router/sale contracts.
- Same-origin RPC reads with public backup endpoints and recovery controls.
- Exact ERC20 approvals, explicit transaction review, bounded slippage and quote expiry.
- Submitted hashes exposed immediately, before waiting for confirmations.
- Local pending/confirmed/reverted/unknown transaction records. An unresolved record restores an explicit confirmation-check state after reload and blocks another submission through the same form.
- Receipt checks distinguish a reverted transaction from an unknown confirmation. A confirmed transaction is not reported as failed merely because the later balance refresh failed.
- Faucet claim status and balance refresh. Native gas balance refreshes on transaction events.
- Native dialogs, keyboard focus, mobile layout, a root error boundary, and separate scoped demo styles.
- Mocked-wallet browser tests exercise user-triggered exact approval, no automatic swap after approval, wallet rejection, pending hash preservation, reload recovery and style isolation. These tests do not sign real transactions or use a private key.

## Blocking a production release

| Gate                   | Status  | Required action                                                                                                                                                                              |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract security      | Blocked | Independent review/audit of the sale, adversarial token tests and appropriate deployment ownership. Existing tests are not an audit.                                                         |
| Source verification    | Blocked | Verify deployed source, constructor parameters and canonical artifact provenance on the explorer.                                                                                            |
| Real trading assets    | Blocked | Verified Circle/bridged token registry, actual third-party liquidity and market/route discovery; all current t* assets are freely minted and valueless.                                      |
| Lending                | Blocked | Integrate an existing verified market, oracle, reserve/risk configuration and health-factor/liquidation UI. No Aave deployment is enabled.                                                   |
| Rewards                | Blocked | Wallet-authenticated backend, successful-receipt indexing, replay protection, activity caps and wash-trade filtering. Browser XP remains demo-only.                                          |
| Transaction edge cases | Partial | Full replacement/cancellation detection, multiple outstanding transactions, provider failure after broadcast without returning a hash, and cross-tab coordination need adversarial coverage. |
| Public hosting         | Blocked | Deploy to a supplied domain/host, validate the Nginx container and RPC routes, configure HTTPS/TLS/HSTS at the reverse proxy. No public hosting target has been supplied.                    |
| Operations             | Blocked | RPC/indexer monitoring, contract alerts, privacy-conscious error telemetry, support/recovery process and incident response.                                                                  |
| Production keys        | Blocked | Hardware signing/multisig and proper secret management. The unattended testnet keystore/password setup is not suitable for real funds.                                                       |
| Accessibility          | Partial | Keyboard/mobile tests exist, but an independent contrast, screen-reader and touch-target audit is still required.                                                                            |

## Scope and limitations

The Activity view is browser-local history, not a complete account indexer or authoritative portfolio. Records may be edited by the browser user. It does not award live XP or establish financial entitlements.

Pending transaction guards are a safer preview workflow, not a guarantee against every possible duplicate transaction. If the wallet/provider reports an uncertain broadcast, inspect the wallet and explorer before retrying. Do not mistake a timeout for a revert.

This release remains testnet-only. Do not enable mainnet or accept real-value funds to satisfy a visual readiness request. Production gates need evidence, not a relabeling of the demo.
