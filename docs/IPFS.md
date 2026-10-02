# Mofu: Pinata logos and public profiles

Public domain target: `https://mofu.lol`. IPFS metadata schemas and legacy browser keys remain compatible with the former Orbit branding.

## Local development

1. Create a Pinata API key with permission to upload public files.
2. Set `PINATA_JWT` in your local `.env` (never `VITE_PINATA_JWT`).
3. Run `pnpm media` in one terminal and `pnpm dev` in another.
4. Connect your wallet. On Launch a token, choose a PNG/JPEG/WebP logo under 2 MB and sign the upload authorization. The resulting `ipfs://CID` is written into the existing launch contract's `image` field when you launch. No contract redeployment is needed.
5. Open Portfolio → Edit IPFS profile (or Wallet → Your profile). Upload a photo, enter a display name/bio/HTTPS website, then publish with a wallet signature.

Existing tokens without an image retain their deterministic fallback avatar. Existing launch images cannot be edited through the current contract. Failed gateway images also fall back to deterministic marks.

## Storage and identity

Logos and profile JSON are public files pinned through Pinata's public upload API. Browsers display them through `https://gateway.pinata.cloud/ipfs/`. Profile metadata includes the wallet address, name, bio, avatar URI, and website. Public pages are at `#/profile/0xADDRESS`; trader links and the leaderboard link to them.

The media server maintains a wallet → latest profile record/CID index in `MEDIA_DATA_DIR/profiles.json` (default `./storage`). This index is **not an on-chain identity registry**: back it up and keep the volume persistent. Run one media-server instance against this file; use a database for multi-instance deployments. Changing a profile pins a new immutable JSON file; old public versions may remain accessible. Do not publish secrets or personal information you want to delete later. Unused uploads are not automatically unpinned.

Publishing requires a short-lived, single-use challenge bound to the action and SHA-256 digest of the payload, signed by the owning wallet. Image signatures and sizes are checked server-side; SVG is deliberately unsupported. The Pinata credential never reaches the browser. Basic rate limiting is included; configure edge per-user/IP limits and abuse moderation for public production. Display names are user-provided, not verified identities; the wallet address remains visible on the profile and in the leaderboard link tooltip.

## Deployment

With Docker: `docker compose up --build -d` after setting `PINATA_JWT` on the server. Nginx serves port 8080; the media sidecar shares nginx's loopback network. The named `profiles` volume persists the profile index. Use HTTPS at your reverse proxy (browser SHA-256 requires a secure context; localhost is allowed).

Without Docker: run `node --env-file-if-exists=.env server/media.mjs` as a supervised Node 22 service beside nginx. Nginx proxies `/api/media/` to `127.0.0.1:5192`; the Next.js development server uses the same proxy in development. Keep that port private. The updated nginx CSP permits Pinata gateway images.

For manual nginx deployment, generate its config after each frontend build with `node scripts/build-csp.mjs --output-dir out --output /tmp/mofu-nginx.conf` (use `out-mainnet` for mainnet). Install the generated config alongside `deploy/rpc-proxy.conf`. The source `deploy/nginx.conf` is a template; its script hashes must match the deployed export so Next.js can start under the CSP. Docker performs this step automatically.

`MEDIA_PORT` is configurable, but the Next.js/nginx proxy must be changed to match if you change it. The static-export Dockerfile can still serve the app, but uploads/profile lookup require the media sidecar. Pinata quotas and gateway availability apply.
