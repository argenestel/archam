# Mofu

An all-in-one DeFi MVP for **Arc Testnet**: discover coins, launch a token, trade its bonding curve or onchain limit orders, manage holdings, and swap or bridge stablecoins in one wallet-connected application.

The product idea is a USDC-first home for new Arc markets. A responsive landing page introduces the experience, Explore presents clearly labeled example markets, and Launch, Trade, Portfolio, Swap, and Bridge provide the application flows. Example prices, charts, and assets are previews, not live markets or executable quotes.

## What works

- **Launch:** deploy or join a launch market; create ERC-20 coins with immutable metadata; buy and sell whole tokens against a native-USDC bonding curve.
- **Trade:** deploy or join an orderbook tied to that launch market. Post fully escrowed bids and asks, explicitly fill all or part of an order, cancel remaining quantities, and withdraw USDC settlement credits. There is no automatic matching.
- **Portfolio:** read native USDC, orderbook credits, and wallet holdings among the latest 40 coins in the selected market. External assets, older coins, and escrowed tokens are outside this holdings view; no total valuation is invented.
- **Swap and Bridge:** Circle App Kit USDC/EURC swap and CCTP USDC bridge flows, subject to supported networks, endpoint availability, and testnet liquidity.

Chain actions require the connected wallet's signatures and testnet gas. The repository does not establish a public deployment or ship signing keys. Contracts are unaudited and intended for testnet use.

## Run locally

Use Node.js 22.6+ (with TypeScript stripping for the Node tests), pnpm, and Foundry for contract work.

```sh
cd dashboard
pnpm install
cp .env.example .env.local
pnpm dev
```

Open the local URL printed by Next.js. Injected wallets work without a WalletConnect project ID. [Dashboard setup and validation](dashboard/README.md) covers deployment, optional shared addresses, and local integration tests.

## Repository

- `dashboard/`: Next.js application, wallet and Circle integrations, generated contract artifacts, and local integration scripts.
- `contracts/src/CurveLaunchpad.sol`: launch registry and reserve-backed curve tokens.
- `contracts/src/MofuOrderBook.sol`: native-USDC escrow orderbook for the registry's tokens.
- `.omx/plans/`: MVP scope and verification criteria.

## Next milestones

1. Add a durable event indexer for complete market history, portfolio coverage, volume, price charts, and globally sorted order depth. Current onchain reads are bounded and paginated.
2. Design and test automated matching and routing between curves and orderbooks; specify execution priority, fees, and price protection before adding it.
3. Integrate external assets only with concrete token issuers, liquidity sources, supported deployments, and appropriate asset controls. Tokenized stocks, lending, and leveraged perpetuals are separate products, not capabilities of this MVP.
4. Add transaction recovery persistence, operational monitoring, and broader funded-wallet/Circle integration coverage.
5. Complete independent contract audits and production infrastructure validation before considering a separate mainnet release.

# archam
