# Mofu as an Arc superapp — plan and status

Mofu is the front door to Arc. A user, or the AI fund manager, should be able to launch, trade, earn, borrow and move money across Arc apps from one place, always on the best venue and only through contracts verified on-chain.

```
                  ┌──────────────── Mofu ─────────────────┐
 User / AI agent ─┤  Smart router   Portfolio   Activity   │
                  └──────┬────────────────────────────────┘
                         │ one adapter per protocol
  ┌──────────┬──────────┬┴─────────┬──────────┬──────────┬──────────┐
 Mofu curve  Mofu V2    Uniswap v4  Circle    Morpho     Aave V4 …
 (launches)  (graduated) (pools)    App Kit   vaults/
                                    swap      markets
```

## Principles

1. **Adapters, not pages.** Each protocol is a module in `src/lib/adapters/` with the same shape (`supports`, `quote`, `execution`). Pages and the agent only talk to adapters.
2. **Best venue wins.** The router asks every venue in parallel and preselects the best output. The user can pick another, and a failing venue never blocks the rest.
3. **Verified addresses only.** Every contract comes from a committed manifest. The tx runner checks runtime bytecode against `verify:mainnet` hashes before signing (Mofu contracts, Uniswap Universal Router, Permit2…).
4. **Explicit steps.** Approvals (ERC-20, Permit2) are separate clicks; nothing chains automatically.
5. **Integration levels.** Execute (full in-app) → Read (positions/prices, link out) → Directory (verified link).

## Status

| # | Step | Status | Notes |
| --- | --- | --- | --- |
| 1 | Mainnet launch wiring | **Done** | Mainnet reads the live `mofu` record (MofuLaunch `0xB583…5cb4`, V2 router/factory); Launches is the home page; Create respects live `launchesPaused`; protocol hub moved to **Arc apps**; market cap uses the real minted supply. |
| 2 | Adapter layer + smart router | **Done (swap)** | Adapters: Mofu curve, Mofu V2, **Uniswap v4**, Circle. **Best price** is the default Swap mode on both networks. |
| 3 | Bridge in (CCTP via App Kit Bridge) | **Done (EVM sources)** | **Add funds** page: USDC/EURC from ~25 EVM chains; Circle's Forwarding Service mints on Arc, so no Arc gas is needed. Fast or Standard speed, fee estimate before signing, journaled transfers with explorer links, retry, and an explicit resolve for uncertain submissions. Measured fees: Base→Arc mainnet 100 USDC Fast ≈ 0.0036 transfer + 0.016 forwarding. Solana source needs the Solana adapter (not added). **No real bridge transfer has been run yet.** |
| 4 | Aave V4 | **Done (earn)** | Addresses from Aave's generated address book (bgd-labs `AaveV4Arc.ts` @ f648e5dd), verified by `verify:mainnet` (28 contracts). Earn page lists the four ERC-4626 tokenization vaults (waCoreUSDC/EURC/cirBTC/WETH) with **realized 24h APY** from share-price growth (USDC ≈ 0.9%), TVL and your position; supply and withdraw/redeem through the checked tx runner. Deposit → redeem round trip simulated on mainnet state (0.1 USDC → 0.099999 back). Borrowing on Aave's Main Spoke (position managers) is not integrated. |
| 5 | Unified portfolio over adapters | Planned | Positions from every adapter; oracle prices (Chainlink/Pyth/RedStone/Stork/Chronicle). |
| 6 | Agent on adapters + ERC-8004 identity | **Partly** | Agent tools `quote_best_swap` / `swap_best` run the app's router (testnet-verified: 10 tUSDC → 0.00371 tETH via Mofu pool). ERC-8004 identity not done. |
| 7 | Arc app directory | Partly | "Arc apps" lists verified protocol contracts; extend to more apps with read/execute levels. |

## Uniswap v4 on Arc: what was verified

- Official registry addresses (PoolManager, Universal Router 2.0 and 2.1.2, PositionManager, V4Quoter, StateView) are verified by `verify:mainnet`.
- `scripts/probe-v4.mjs` scans standard hookless tiers. As of 2026-10-02 the only pool with liquidity is **USDC/EURC 0.05%** (pool id `0xeb0f…d1ae`); USDC/cirBTC, USDC/WETH and EURC/cirBTC have none.
- **Arc's Universal Router uses the newer `ExactInputSingleParams` with a `minHopPriceX36` field.** The classic 5-field struct reverts while decoding. Found by `eth_call`; the encoder sets the field to 0 (no per-hop floor; `amountOutMinimum` still protects the user).
- Full approve → Permit2 → `execute` sequences were **simulated against mainnet state** with `eth_simulateV1` (dRPC endpoint). The received amount equalled the quote in both directions: 0.1 USDC → 0.088943 EURC, 0.05 EURC → 0.056159 USDC. **No real-funds v4 swap has been sent yet.**

## Venues per pair (mainnet today)

| Pair | Venues |
| --- | --- |
| USDC ↔ EURC | Uniswap v4, Circle (needs a connected wallet to quote) |
| USDC ↔ cirBTC, EURC ↔ cirBTC | Circle only (no v4 liquidity) |
| USDC ↔ Mofu launch token | Mofu curve before graduation; Mofu V2 pool after |
| Launch token ↔ other token | Via USDC on Mofu V2 after graduation (single router call); before graduation, two steps |

## Next build steps

2. Earn and Borrow behind the same adapter interface, so the agent can rebalance through it.
3. Agent: replace the agent's direct App Kit calls with the adapter router (shared quotes, same safety checks).
4. Aave V4: verify addresses, then a read-only adapter (rates, positions), then execution.
