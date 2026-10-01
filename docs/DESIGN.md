# Interface direction

The previous dashboard accumulated too many competing elements: greetings, repeated risk banners, faucet cards, a pool illustration, fake/demo metrics, and several simultaneous primary actions. The user's feedback was that this was neither clean nor production-ready.

## Current live interface

- One centered swap card, with a quiet horizontal navigation bar.
- One primary action matching the next step: connect, approve, review, or check an uncertain transaction.
- Empty inputs by default; no prefilled trade suggesting a recommended amount.
- Token balances next to the inputs. Token selection, slippage settings and review use native dialogs.
- Faucet controls live behind **Get test tokens**.
- Real pool reserves and contract links live behind **Pool & contract details**.
- A concise testnet label stays visible; the full risk explanation is available on demand.
- Only implemented live workflows appear in navigation: swap, test sale, and local activity.
- The old lending/rewards/demo dashboard is explicitly separate, lazy-loaded and CSS-scoped. It cannot style the live interface after switching modes.

Typography: self-hosted DM Sans Variable for controls, Space Grotesk Variable for amounts. Neutral near-white surfaces and a single muted purple action color. No decorative charts, gradients, or onboarding illustration on the primary screen.

The public [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) was consulted in the earlier pass. The latest revision follows the user's feedback by removing unnecessary material rather than adding another dashboard treatment.

## What this does not establish

A cleaner interface is not a production-readiness claim. Independent security review, real-asset integrations, a verified lending market, backend-verified rewards, public HTTPS hosting and operational monitoring remain unresolved. See `RELEASE.md`.
