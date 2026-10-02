# Mofu privacy notice — DRAFT

> **Draft for legal review. Not approved, not legal advice.** Intended domain: **mofu.lol**. Controller identity, jurisdiction, hosting and retention periods still require review.

## What Mofu processes

Mofu is a wallet-connected interface. Public profiles are optional, and there is no traditional password account. The current implementation has no analytics integration.

| Data | Where it goes | Why |
| --- | --- | --- |
| Wallet address and transactions | Public Arc blockchain | Transactions and contract state are public. |
| Blockchain queries | Mofu RPC proxy and Arc RPC providers | Balances, quotes and receipts. Hosting logs may include IP addresses. |
| Swap, Earn and Borrow requests (address, amounts, positions) | Circle App Kit services | Discover, quote, route and index protocol actions. Third-party privacy policies apply. |
| Profile names, bios, photos, websites and token logos | Pinata public IPFS storage | Public token and wallet profile metadata. Upload/publish authorization uses a wallet signature. |
| Latest profile record and CID mapped to wallet address | Mofu media server's persistent index | Resolve the current public profile. This is not an on-chain identity registry. |
| Transaction recovery journal, follows and wallet selection | Browser local storage | Convenience and duplicate-submission protection. Legacy keys may retain the former Orbit prefix. |

## Retention

IPFS data is public and immutable: old versions may remain accessible after a profile changes or an image is removed from the UI. Do not publish secrets or personal information you expect to delete later. Blockchain history is permanent. Media profile-index backups, server access-log retention and deletion procedures are **not yet specified** and must be set before a production launch.

Mofu's browser interface does not request or store your private key. Operator/deployer wallet secrets are separate local/server operational configuration, never public profile metadata or browser build variables.

## Open items for counsel

Controller identity/contact, jurisdiction-specific rights, profile-index deletion and backup retention, Pinata/Circle processing terms, IPFS permanence notices, log retention, moderation, and whether cookies or consent controls are needed for the eventual hosting configuration.
