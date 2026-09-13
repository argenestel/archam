# Arc bonding-curve launchpad

`src/CurveLaunchpad.sol` is the legacy launchpad implementation:

- `CurveLaunchpad`: permissionless registry with `createToken`, `tokenCount`, and indexed `tokens` reads.
- `CurveToken`: OpenZeppelin ERC20 + ReentrancyGuard, zero initial supply, immutable creator/metadata, no owner or privileged withdrawals.
- Buy and sell quantities are **whole tokens**. ERC-20 balances use 18 decimals.
- Payments use **native USDC with 18 decimals**, not the six-decimal ERC-20 interface.
- Buy cost: `R(s+q)-R(s)`, sell proceeds: `R(s)-R(s-q)`, where `R(s)=s*10^12+s*s*5*10^8` and `s` is whole-token supply.
- 1,000,000-token cap, 501 USDC reserve at cap. Legacy coins can never graduate: this contract deliberately has no pool creation, graduation flag, or liquidity migration function.
- Max-cost/min-return, deadlines, refund handling, and reentrancy protection are enforced onchain.

```sh
forge build
forge test
cd ../dashboard && node scripts/export-curves.mjs
```

The UI can deploy the registry once using a browser wallet. Set its address as `NEXT_PUBLIC_LAUNCHPAD_ADDRESS` to share a market across all clients. The contract source does not hardcode a deployment address; the current checkout joins its public Arc Testnet deployment through `dashboard/.env.local`.

Tests cover registry creation, zero premint, buy/sell, excess-payment refund, supply cap, slippage, deadline expiry, unauthorized sells, and fuzzed reserve solvency. A local Viem integration check lives at `dashboard/scripts/test-curve-local.mjs`.

OpenZeppelin 5.7.0 is vendored in `lib/openzeppelin-contracts`; if missing:

```sh
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git
```

Local tests cannot reproduce Arc's restricted-address and native-value rules. This is an **unaudited testnet prototype**. Run funded Arc tests and obtain an independent security review before any production use.

Graduating tokens belong to the separate `src/MofuV2.sol` protocol. Do not add a graduation path to this legacy contract without a new audited protocol and migration plan.
