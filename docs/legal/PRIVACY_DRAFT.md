# Privacy notice — DRAFT

> **Draft for legal review. Not approved, not legal advice.** Facts below describe what the code does as of 2026-10-02; counsel must review jurisdiction, controller identity and wording before launch.

## What Orbit collects

Orbit has no accounts, database or analytics. The web app runs in your browser.

| Data | Where it goes | Why |
| --- | --- | --- |
| Wallet address, transactions | Public Arc blockchain | Every trade is a public transaction. |
| Blockchain reads (your address appears in queries) | Orbit's RPC proxy, which forwards them to Arc RPC providers (Circle, QuickNode, dRPC) | To show balances and positions. The proxy host sees your IP address in its access logs. |
| Swap and Earn requests (address, amounts) | Circle App Kit services | To quote and route stablecoin swaps and vault deposits. Circle's privacy policy applies. |
| Transaction history, follows, chosen wallet | Your browser's local storage only | Convenience. Clear it anytime from browser settings. |

## Retention

Orbit stores nothing server-side except standard web-server access logs (IP, path, time), kept for [N days — decide]. Blockchain data is permanent and outside anyone's control.

## Open items for counsel

Controller identity and contact; log retention period; jurisdiction-specific rights (GDPR/CCPA); whether RPC proxy logs are needed at all; cookie banner (none needed today: no cookies are set).
