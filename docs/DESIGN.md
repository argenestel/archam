# Interface direction (2026-10 redesign)

**Concept: a dark launch terminal.** It should have the energy of a live trading floor (ticker, flashing cards, live feed) while every action stays one obvious button.

- **Palette:** near-black ink surfaces (`--bg #07080a`, raised `--surface`), a faint orbital grid and two soft glows. There is one signal accent, lime `#c6f55c`, used for buys, primary actions and "live". Coral `#ff7a6b` marks sells and errors, and gold `#f6c75a` marks graduation and King of the Orbit. Nothing else gets color.
- **Type:** Space Grotesk (display), DM Sans (UI) and JetBrains Mono (every number, tabular). All three are self-hosted.
- **Identity without remote images:** tokens and wallets get deterministic "orbital" SVG avatars derived from their address. The strict CSP (`img-src 'self' data:`) stays intact, and nobody can inject imagery.
- **Prices:** sub-cent launch prices use subscript-zero notation (`$0.0₇196`).
- **One action at a time:** `ActionButton` walks connect → switch network → exact approval → action. Each step is its own click; an approval never auto-continues.
- **Motion:** ticker marquee, feed-row entry, card flash on new trades, button press scale. All of it is disabled under `prefers-reduced-motion`.
- **Mobile:** bottom tab bar, single-column grids, and no horizontal overflow at 360/390/768/1280/1440 (enforced by `e2e/app.spec.ts`).

There is a single stylesheet (`src/styles.css`). The legacy demo workspace and its four override stylesheets were removed.

The owner has not yet approved this direction (see UX-01).
