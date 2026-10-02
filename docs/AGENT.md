# Orbit fund manager (AI agent)

An MCP server that lets Claude Code, Codex or any MCP client manage a wallet on Arc. It reads market data, then swaps, lends and rebalances within limits you set. You choose the strategy in conversation; the policy file decides what the agent may actually do.

```text
Claude Code / Codex / any MCP client
        │  MCP (stdio)
        ▼
agent/server.mjs ── policy.mjs (caps, allowlists, dry-run, audit log)
        │
        ├─ Circle App Kit: token prices, Earn vaults (Morpho), Swap (USDC/EURC/cirBTC)
        └─ Arc RPC: balances, Orbit Morpho market
```

## Tools

| Tool | Writes? | What it does |
| --- | --- | --- |
| `get_policy` | no | Current limits and dry-run state |
| `get_market_data` | no | Data feed: USD prices, Earn vault APYs/liquidity/risk warnings, Orbit market utilization |
| `get_portfolio` | no | Gas, USDC, EURC and vault positions for the agent wallet or any address |
| `quote_swap` | no | App Kit quote with fees and minimum received |
| `swap` | yes | USDC/EURC/cirBTC swap via App Kit |
| `earn_deposit` / `earn_withdraw` | yes | Move USDC in or out of an Earn vault |
| `plan_rebalance` | no | Baseline strategy: keep a gas reserve, put idle USDC in the best eligible vault, move between vaults only for ≥ `minApyImprovementBps` |
| `execute_rebalance` | yes | Runs that plan through the policy engine |
| `get_activity` | no | Audit log (`agent/logs/actions.jsonl`) |

Every write tool takes `confirm` (default `false`, which means simulate and log only) and a `reason` that is recorded.

## Safety model

1. **Dedicated wallet.** `ORBIT_AGENT_PRIVATE_KEY` lives in git-ignored `agent/.env`. The server refuses the deployer key. Fund the agent wallet with only what you're willing to delegate.
2. **Policy file** (`agent/policy.json`, editable only by you): per-transaction and 24-hour USD caps, allowed actions and tokens, vault allowlist, max slippage, gas reserve, `dryRun`.
3. **Two keys to turn on real writes:** `dryRun: false` in the policy *and* `confirm: true` on the call.
4. **Mainnet lock:** a mainnet policy needs `"mainnetEnabled": true` *and* the env var `ORBIT_AGENT_ALLOW_MAINNET=1`.
5. **Withdrawals are never blocked by the gas-reserve rule**, so funds can't get stranded in a vault.
6. **Audit log:** every simulated, executed and failed action is written to the log with its reason.

## Connect

**Claude Code:** the repo ships `.mcp.json`. Open Claude Code in this folder and approve the `orbit-fund-manager` server, then ask, for example: "Check the Earn vaults and move my idle USDC to the best one, keep 0.5 USDC for gas."

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.orbit-fund-manager]
command = "node"
args = ["--env-file-if-exists=agent/.env", "agent/server.mjs"]
cwd = "/path/to/archam"
```

**Headless / scheduled:**

```sh
pnpm agent market                 # data feed
pnpm agent portfolio              # agent wallet
pnpm agent plan                   # proposed steps, no writes
pnpm agent rebalance --execute    # run the plan through the policy
```

Run `rebalance --execute` from cron, or from Claude Code's `/loop`, for an autonomous yield manager.

## Verified on Arc testnet (2026-10-02)

Agent wallet `0xcB585703f17267eC63c01922556B431988a8e870`, all through MCP or the core module:

- Over-cap swap rejected; swap without `confirm` simulated and logged.
- `execute_rebalance` deposited 4.01 USDC into "EarnKit USDC Vault" (Morpho, 4.2% APY) and kept the gas reserve.
- `earn_withdraw` returned 2.00 USDC to the wallet.
- **Swap execution was not verified.** One USDC→EURC quote succeeded (1 USDC → 0.8227 EURC). Later requests to Circle's testnet swap service returned "No route available" regardless of size or balance, which is upstream availability. The tool surfaces that error unchanged.

## Not included yet

ERC-8004 identity registration for the agent (registries exist on Arc: see `deployments/arc-mainnet.json`). Borrow Kit tools (cirBTC → USDC). Multi-wallet portfolio aggregation. Price-feed signals beyond App Kit rates (Chainlink, Pyth, RedStone, Stork and Chronicle are listed by Arc).
