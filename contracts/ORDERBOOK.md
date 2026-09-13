# Mofu spot orderbook (testnet MVP)

`MofuOrderBook` is an escrowed, explicit-fill orderbook for tokens created by one immutable `CurveLaunchpad`. Deploy the launchpad first, then pass its address to the orderbook constructor. The frontend must verify `factory()` matches its configured launchpad. Factory trust is established at deployment; the constructor checks deployed code, not bytecode identity. Deploy only against the provided, unmodified launchpad.

There is no automatic matching engine, leverage, fee, administrator, arbitrary token listing, or liquidity guarantee. Makers choose their price; takers explicitly fill it. Orders use whole-token lots (1–1,000,000), and native USDC prices use 18 decimals per whole token. This is distinct from Arc's six-decimal ERC20 USDC view: do not approve that token to fund orders.

- `postOrder(tokenIndex, isBuy, quantity, price, expiry)` returns a zero-based ID. Bids attach exactly `quantity * price` native USDC. Asks attach zero and first approve `quantity * 1e18` launch tokens. Expiry must be in the future and at most 30 days away.
- `fillOrder(id, quantity)` allows partial fills before expiry. Filling an ask attaches exactly `quantity * price`. Filling a bid attaches zero and requires an allowance of `quantity * 1e18`. Tokens move immediately; native proceeds become `credits(recipient)`.
- `cancelOrder(id)` is maker-only, including after expiry. Unfilled ask tokens return immediately; unfilled bid funds become maker credits. Expiry does not release escrow automatically.
- `withdraw()` pays the caller's entire native credit. Reverting recipients retain their credit. Recipient contracts must be able to accept native USDC. There is no third-party withdrawal destination.
- `orders(id)` returns maker, token, isBuy, remaining, price, expiry. `orderCount()` includes closed orders. Remaining zero means closed. Read only IDs below the count; unknown mappings return zero values.

SafeERC20 handles token transfers and ReentrancyGuard protects all mutations. Checked price bounds prevent multiplication overflow; exact payment checks reject accidental overpayment. Factory tokens are standard 18-decimal CurveTokens: fee-on-transfer, rebasing, and callback tokens are not supported. No admin recovery exists for tokens mistakenly sent directly to the contract or forcibly sent native funds.

Run `forge test` from `contracts`, then `node scripts/export-orderbook.mjs` from `dashboard` after rebuilding to refresh the UI ABI and bytecode. For local integration start `anvil --chain-id 5042002 --port 8547`, then run `node scripts/test-orderbook-local.mjs` from `dashboard`. This script is restricted to localhost and uses unlocked development accounts; it does not broadcast to Arc.

This contract has local adversarial and fuzz coverage, but no independent audit. Remote Arc deployment and browser-wallet transaction verification are separate release checks.
