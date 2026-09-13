# Mofu dashboard

Next.js frontend for the Mofu all-in-one Arc Testnet DeFi MVP. Landing and Explore examples are clearly labeled previews. Launch, Trade, Portfolio, Swap, Bridge, and graduating-token V2 flows use wallet and chain integrations. The checked-in local environment joins the deployed legacy launchpad/orderbook; the V2 factory is configured when its public deployment is available.

## Run

Node.js 22.6+ and pnpm:

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Injected wallets work without credentials. Optional public environment variables:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect/mobile wallet support |
| `NEXT_PUBLIC_LAUNCHPAD_ADDRESS` | Shared Arc Testnet `CurveLaunchpad` deployment |
| `NEXT_PUBLIC_ORDERBOOK_ADDRESS` | Shared `MofuOrderBook` bound to that same launchpad |
| `NEXT_PUBLIC_MOFU_V2_FACTORY` | Shared V2 factory for graduating tokens and locked pools |
| `NEXT_PUBLIC_ARC_MAINNET_RPC` | Explicit Arc Mainnet RPC used for router readiness checks |
| `NEXT_PUBLIC_ARC_MAINNET_EXPLORER` | Optional Arc Mainnet explorer URL |
| `NEXT_PUBLIC_ARC_MAINNET_ROUTER` | Explicit router address; code is verified before it is marked ready |
| `NEXT_PUBLIC_ARC_MAINNET_FACTORY` | Router factory used to resolve direct and one-hop pairs |
| `NEXT_PUBLIC_ARC_MAINNET_USDC` | Arc Mainnet USDC ERC-20 address |
| `NEXT_PUBLIC_ARC_MAINNET_EURC` | Arc Mainnet EURC ERC-20 address |

Leave addresses empty to deploy or join through the browser. Local selections are saved in that browser. Restart/rebuild after changing environment values. Never expose private keys, Circle entity secrets, or Circle API keys in this app.

Arc Mainnet stablecoin routing is explicitly configured in the local environment
through the ArcSwap DEX router. The header and `pnpm verify:mainnet-router` check
chain ID `5042`, router bytecode, router/factory binding, the USDC/EURC pair, and
a positive quote before enabling the route. The route starts with ERC-20 USDC/EURC
and supports imported ERC-20s plus one-hop paths through those stablecoins. It
requires mainnet funds; Mofu launchpad/orderbook contracts and Circle App Kit
flows remain on Arc Testnet.

## First market and trade

1. Connect a funded Arc Testnet wallet. Testnet funds are available from [Circle's faucet](https://faucet.circle.com).
2. In **Launch**, choose **Set up testnet market** to deploy `CurveLaunchpad`, or join a trusted deployment in market settings.
3. Create a coin with a name, ticker, grayscale artwork or image URL, and optional description. Buy tokens through its curve after confirmation.
4. In **Trade**, choose **Set up orderbook**, or join a trusted orderbook. Its immutable factory address must match the selected launch market. Share both addresses so other users join the same market.
5. Select a pair and post a limit order. Buy orders escrow native USDC; sell orders approve the exact token quantity and then escrow tokens. Wallet signatures and gas are required.
6. Another trader can explicitly fill an order partially or completely. Crossing prices do not automatically match.
7. Cancel unfilled quantities, including expired orders, to recover escrow. Sell-order tokens return to the wallet; buy-order refunds and sale proceeds become USDC credits that require **Withdraw**.

Joining checks the factory relationship, not the deployed contract's authenticity. Use trusted deployments of the included contracts.

The orderbook reads up to 40 orders per page and filters/sorts that page by pair. It is not a global best-price feed. Trading pairs are paginated. Portfolio reads native USDC, settlement credits, and holdings among the latest 40 coins; older/external coins and escrowed tokens are excluded.

### Seed a MOFU orderbook demo

To put a visible bid/ask ladder on the shared Arc Testnet book, run the guarded
activity script from `dashboard/`:

```sh
MOFU_ACTIVITY_DRY_RUN=1 pnpm activity:testnet
MOFU_ACTIVITY_CONFIRM=ARC_TESTNET pnpm activity:testnet
```

The script resolves the registered `MOFU` token, verifies that the configured
orderbook is bound to the configured launchpad, buys only the MOFU inventory
needed for the asks, and posts three bids plus three asks with a seven-day
expiry. It refuses to add a second ladder unless
`MOFU_ACTIVITY_ALLOW_EXISTING=1` is set. It uses the explicit
`MOFU_DEPLOYER_PRIVATE_KEY` from the deployment environment and never accepts
a mnemonic. Set `MOFU_ACTIVITY_TOKEN_ADDRESS` if a launchpad contains more
than one MOFU-symbol token. The dry run performs no writes.

## Bonding curve

`../contracts/src/CurveLaunchpad.sol` contains the registry and ERC-20 curve token. Each coin starts with zero supply: no creator allocation, presale, owner, mint authority, platform fee, or reserve withdrawal function.

For whole-token supply `s`, cumulative reserve in 18-decimal native USDC units is:

```text
R(s) = s * 10^12 + s^2 * 5 * 10^8
buy(q)  = R(s + q) - R(s)
sell(q) = R(s) - R(s - q)
```

Buying mints; selling burns. The cap is 1,000,000 tokens, backed by 501 USDC at the cap. Tokens have 18 decimals, but curve and orderbook trades use whole-token quantities. ERC-20 transfers may carry fractional balances.

Curve quotes refresh every 10 seconds; transactions enforce 1% slippage limits and a deadline. The launch feed shows 12 coins per page and searches the current page. Metadata is immutable and onchain; icons do not require an image-storage backend.

Reserves back redemptions. The curve includes reentrancy guards and excess-payment refunds. There is no automatic DEX graduation, liquidity pool, Circle Swap listing, chat, or production indexer. Supply progress is not graduation progress. Contracts are unaudited and testnet only.

## Mofu v2 (launch → curve → locked pool)

`contracts/src/MofuV2.sol` is the new launch protocol, independent of the v1 `CurveLaunchpad` (v1 deployments remain readable). It adds:

- **Any ERC-20 as the quote asset** — USDC, EURC, another Mofu token, or an RWA/stock token deployed on Arc. No WETH-style wrapper and no native-value path; quote assets use their standard ERC-20 interface, and `quoteDecimals()` is read at launch for formatting.
- **Images onchain** — `imageURI` stores the selected local artwork path or a validated image URL.
- **Linear bonding curve** — fixed 1,000,000 supply, `endPrice = startPrice * 1,000`, 1% fee. The curve sells ~66.6% and reserves ~33.4% for liquidity, so the pool opens at the curve's final price.
- **Graduation** — when the curve sells out, inside the finishing buy it deploys `MofuPool`, seeds it with the raised quote plus the reserved tokens, and calls `sync()`. There are no LP tokens: liquidity is permanently locked and cannot be withdrawn. If graduation ever needs a nudge, the sold-out state is public and permissionless to complete.
- **One Swap path** — after graduation `quoteBuy`/`quoteSell` revert `"graduated"` and all trades go through the pool, so the UI can route curve vs pool by reading `graduated()` / `pool()`.
- **Reward launches (`rewardMode`)** — a share of every curve and pool fee accrues to holders through a per-share accumulator (`magnifiedPerShare`), and holders call `claim()`. Fees are paid in the quote asset. The 1% fee splits 40% creator / 10% protocol / 50% holders in reward mode, and 70% creator / 30% protocol in standard mode.

### Honest difference from StonkFun

StonkFun runs on Solana, where a Token-2022 transfer-fee extension can pay holders in the quote token on every transfer. A plain EVM ERC-20 cannot tax a transfer in a different token, so Mofu reward launches **accrue fees and let holders claim** them instead of auto-pushing. The economics match; the mechanism does not.

### v2 validation

```sh
cd contracts && forge test --match-path test/MofuV2.t.sol
cd dashboard && pnpm export:v2 && pnpm test:v2-local   # needs anvil on 8547
pnpm test:v2-ui-local                                    # needs anvil and pnpm dev
```

## Swap and bridge

The dark interface uses neutral shadcn-style tokens, Radix controls and dialogs, grayscale artwork, and a persistent RainbowKit wallet button. Swap coin selection uses a shared searchable Jupiter-style modal. The picker discovers configured Mofu markets and the public ArcScan ERC-20 index, and can validate a pasted address directly against Arc RPC. Tokens without a verified Mofu curve or pool are selectable for inspection but clearly marked as having no route; detection never invents liquidity.

- **Swap → Graduating tokens:** V2 tokens trade against their curve until the final buy creates a permanently locked pool; the same widget then routes buy/sell through that pool. Select a token from the modal, review the quote, approve the exact asset, and confirm.
- **Swap → Launched coins:** native USDC ↔ any coin in the selected legacy launch market through its bonding curve. Choose a coin through the searchable modal, direction, and whole-token quantity. Buying specifies the number of coins to receive; selling specifies coins to send. Fresh onchain quotes, a 1% maximum payment/minimum receipt, simulation, and a two-minute onchain deadline protect execution. Confirmed swaps refresh portfolio and market data. Launch and Portfolio shortcuts carry the selected coin into Swap or Trade. Coin-to-coin atomic routing is not provided.
- **Swap → USDC / EURC:** Circle App Kit's keyless USDC ↔ EURC flow on Arc, with estimate/review/confirm, 60-second estimates, selectable slippage, and reviewed minimum output enforced as a stop-limit. Pending results are polled; testnet liquidity may be limited.
- **Bridge:** Circle CCTP USDC transfers across Arc Testnet, Ethereum Sepolia, and Base Sepolia to the same connected wallet. Review SDK fees before signing. Keep gas on both networks: USDC on Arc, ETH on Sepolia.
- Failed/partial bridges can be resumed in the current session. Keep the page open; recovery downloads support manual SDK recovery and are not imported by the UI. Tab changes preserve in-progress state; navigation is disabled during signing/execution.
- Public RPCs and keyless Circle endpoints can rate-limit. A timeout after submission does not establish failure; check the explorer before retrying.

Native Arc USDC uses **18 decimals**; its ERC-20 interface uses **6**. They represent the same asset. Curves and orderbook use native USDC; App Kit receives human-readable amounts. Deployment/trading fee estimation enforces a 20 Gwei max-fee floor.

### Deploy all first-class contracts

`pnpm deploy:testnet` verifies Arc Testnet, reuses configured deployments, and deploys any missing `CurveLaunchpad`, `MofuOrderBook`, and `MofuFactoryV2` contracts. It requires a funded explicit signer in the shell; it never accepts a mnemonic and refuses another chain:

```sh
MOFU_DEPLOY_CONFIRM=ARC_TESTNET \
MOFU_DEPLOYER_ADDRESS=0xYourSigner \
MOFU_DEPLOYER_PRIVATE_KEY=0xYourPrivateKey \
pnpm deploy:testnet
```

To create a fresh deployment address, run `cast wallet new` locally, keep the
private key in a password manager, and fund the address manually at
`https://faucet.circle.com/` with Arc Testnet selected. The public faucet uses
reCAPTCHA and is intentionally not automated by this repository.

The script checks that the orderbook is bound to the launchpad and that the V2 treasury is the signer. Copy the printed `env` values into `.env.local` and restart the dashboard. `MofuTokenV2` and `MofuPool` are created by the V2 factory during launches/graduation; they are not standalone deployments.

## Build and validation

From `dashboard/`:

```sh
pnpm exec tsc --noEmit --incremental false
pnpm lint
node --experimental-strip-types --test tests/market-safety.test.mjs
pnpm build --webpack
```

The production build is verified with webpack. `pnpm build` uses Next.js's default Turbopack path, which encountered a sandbox issue in the development environment; webpack is the available fallback. The Node test uses TypeScript stripping, available from Node 22.6 onward.

From `contracts/`:

```sh
forge build
forge test
```

After contract changes, regenerate frontend ABI/bytecode from `dashboard/`:

```sh
node scripts/export-curves.mjs
node scripts/export-orderbook.mjs
```

The current launch UI uses only `CurveLaunchpad` for legacy curves and `MofuFactoryV2` for graduating launches.

Local integration checks never sign against a public RPC. Build contracts first, then:

```sh
# Terminal 1
anvil --chain-id 5042002 --port 8547
```

```sh
# Terminal 2, from dashboard/
node scripts/test-curve-local.mjs
node scripts/test-orderbook-local.mjs
```

Browser checks (with `pnpm dev` running and Chromium installed):

```sh
pnpm test:ui
pnpm test:swap-ui # also requires the local Anvil instance above and compiled contracts
pnpm test:v2-ui-local # V2 deploy, curve buyout, graduation, pool buy, and pool sell
```

Set `UI_URL` to override `http://localhost:3000`, or `CHROMIUM_PATH` to override `/usr/bin/chromium`. The swap browser test injects an Anvil-only wallet and redirects browser RPCs to localhost; it verifies Launch → Swap buy → Portfolio → Swap sell, including onchain balances. It installs Multicall3 on Anvil if needed. It does not use real wallets or sign on public networks.

These scripts create local-only test coins and verify curve accounting and orderbook deployment, partial fills, cancellations, withdrawals, and balance conservation. They do not seed Arc. Anvil does not reproduce Arc-specific blocklists or native-value behavior. Funded-wallet Arc transactions and Circle crosschain execution require separate network validation.

## References

- [Arc EVM differences](https://docs.arc.io/arc/references/evm-differences)
- [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses)
- [App Kit supported blockchains](https://docs.arc.io/app-kit/references/supported-blockchains)
- [App Kit adapter setup](https://docs.arc.io/app-kit/tutorials/adapter-setups)
- [Bridge quickstart](https://docs.arc.io/app-kit/quickstarts/bridge-tokens-across-blockchains)
- [Swap quickstart](https://docs.arc.io/app-kit/quickstarts/swap-tokens-same-chain)
