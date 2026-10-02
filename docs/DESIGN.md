# Interface direction (2026-10-02, second pass)

The first redesign was rejected as generic. Reviewed against Anthropic's frontend-design skill, it matched the common tells: a near-black page with an acid-green accent, identical rounded cards with glows, all-caps eyebrow labels, `A · B · C` metadata, monospace data labels, and motion everywhere.

## Concept

What makes a launch token unique is **its position on the bonding curve**. The curve is the one bold element: the Launches hero shows the leading token's real curve with its live position, every row carries a mini curve, and each token page shows where it sits. Everything else is quiet.

- **Color:** paper `#f5f6f4`, panel `#fff`, ink `#15181d`, line `#dadddf`, USDC blue `#1d5cf0` for actions and the curve, buy `#0b8a5a`, sell `#d93f3f`. Graduated tokens turn ink-black.
- **Type:** IBM Plex Sans for UI, IBM Plex Sans Condensed for headings and large numbers, tabular figures throughout. No monospace.
- **Structure:** rules separate rows of data; cards only group whole tools. Radius hierarchy: 8px controls, 12px panels, 4px chips.
- **Motion:** only in response to change (the curve dot settling when a trade lands, dialogs opening). No marquee, hover lifts or flashing cards.
- **Copy:** plain, sentence case, user words ("Launches", "Buy $SUBSEC", "more USDC graduates it").
- **Mobile:** below 880px, bottom tab bar and three-column rows; no overflow from 360 to 1440 (`e2e/app.spec.ts`).

The owner has not yet approved this direction (UX-01).
