# Terminal design direction

Consulted the public [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) before redesigning. Its guidance informed the plan and screenshot review; it was not installed as executable code.

## Plan

Keep the user's Sushi/Aave workflows and Jumper-like purple accent, but remove the oversized marketing treatment from the live workspace. Spend visual emphasis on the swap amount and the actual pool exchange ratio. The secondary panel should help users make a trade, not display invented performance charts.

- **Cloud** `#f4f6fa`: workspace background.
- **Paper** `#ffffff`: transaction surface.
- **Ink** `#25283d`: primary text.
- **Orbit violet** `#7045e5`: actions and navigation.
- **Mist** `#e5e8f0`: structural dividers.
- **Connected green** `#198268`: operational status, not promised returns.
- Space Grotesk Variable for headings and amounts; DM Sans Variable for controls and supporting text. Both self-hosted through Fontsource.

```text
navigation | page title                       wallet / mode
           | network status and concise test-asset disclosure
           | swap + approvals  | actual pool reserves / ratio
           | faucet balances   | wallet and gas guidance
```

Left-aligned forms, quieter risk disclosure with expandable details, readable labels and focus indicators. Mobile keeps the swap first, then pool context. No auto-play decoration or fabricated price history. Demo mode remains explicit and separate from live transactions.

Reviewed desktop and 390px mobile screenshots. Automated browser tests exercise mobile overflow, primary RPC failure, all-RPC failure/recovery, and existing demo flows.
