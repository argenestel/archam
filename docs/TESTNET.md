# Arc testnet operations

## Current deployment

Network: Arc testnet, chain 5042002. `deployments/arc-testnet.json` is the source of truth for addresses, constructor parameters, runtime hashes and successful transaction receipts. `public/arc-testnet-deployment.json` is a downloadable copy. UI hashes are bundled from the committed manifest, not fetched from an untrusted registry.

Uniswap V2 factory/router are the canonical published artifacts from pinned `@uniswap/v2-core@1.0.1` and `@uniswap/v2-periphery@1.1.0-beta.0` packages. The tokens and sale were compiled with the lockfile compiler/OZ versions. Source verification on the block explorer has not been completed. Published runtime hashes do not replace source verification/auditing.

The initial tUSDC/tETH liquidity is 268,432 tUSDC + 100 tETH. The deployer owns the initial LP position. Both assets are freely minted and valueless. This is a testing pool, not price discovery for real assets. No native-token routes, real Circle USDC swaps or borrowing are enabled.

The launchpad sells 2 tORBIT per tUSDC, soft cap 1,000 tUSDC, hard cap 200,000 tUSDC. It starts five minutes after setup and runs for seven days; timestamps are in the manifest. Contributions escrow tUSDC. Claim/refund buttons activate according to onchain settlement state. Owner can cancel before sale end and participants can refund. Inventory is fully funded. Contract is experimental/unaudited.

## Wallet security

```sh
pnpm wallet:create     # creates one encrypted Ethereum V3 keystore; refuses overwrite
pnpm wallet:status     # address and native testnet USDC balance only
```

Secrets live at `~/.local/share/orbit/arc-testnet/` in files `deployer.keystore.json` and `deployer.password` (0600 files, 0700 directory). No private key or password is printed, committed, bundled, or passed as a CLI argument. The password is co-located for unattended testnet-only operations: this protects against accidental exposure, **not compromise of this OS account**. Never use this setup or wallet for real funds. Back up privately if needed; production requires hardware signing/multisig and proper secret management.

At the owner's request, an additional plaintext copy is saved in the Git-ignored repository-root `.env` as `ARC_TESTNET_DEPLOYER_PRIVATE_KEY`, with the public address in `ARC_TESTNET_DEPLOYER_ADDRESS`. The file has mode 0600 and is excluded from Docker builds. These variables have no `VITE_` prefix and must never be exposed to the frontend. Existing deployment scripts still load the encrypted keystore; this copy does not change their signer configuration. Do not use this plaintext setup for real funds.

Current public deployer address: `0x1a86d3148df478a1071e9d3d4825c99fb75ec964`.

## Deployment and checks

```sh
pnpm deploy:testnet                  # plan only; no transactions
pnpm deploy:testnet --broadcast      # explicit Arc testnet broadcasts; default 5 USDC gas cap
pnpm smoke:testnet                   # read-only bytecode/quote check
pnpm smoke:testnet --broadcast       # 1 tUSDC swap, 10 tUSDC sale contribution; 0.2 USDC gas cap
```

Deployment checkpoints completed steps and is normally resumable. **If interrupted after sending a transaction but before saving its receipt, check the explorer and reconcile the manifest before retrying.** Do not delete the manifest to rerun a deployment. The smoke broadcast refuses a completed second run, but partial failed runs must also be reconciled manually. Gas caps are bounded per script; deployment receipts and smoke costs are tracked separately. Neither script spends native USDC as trading capital.

## Try live mode

1. Start `pnpm dev`; open the printed IPv4 URL (currently `http://localhost:5191`).
2. Connect an injected wallet and switch to Arc testnet. The default page is the live preview; the footer Demo link opens the separate virtual dashboard.
3. The user wallet needs **native testnet USDC for gas**. Deploying from the server wallet does not connect that key to your browser.
4. Claim tUSDC/tETH faucet assets (once per wallet per token).
5. Enter a valid amount. Approve exact router allowance, review minimum received and recipient, then sign swap.
6. Launchpad shows the deployed test sale. Approve exact sale payment then contribute. Claims/refunds are enabled only when the contract allows them.

No production rewards are earned. Lending, demo portfolio and demo rewards are intentionally separate from testnet receipts.

## Frontend hosting

`pnpm dev` is a development server, not production hosting. To serve the production static build:

```sh
docker build -t orbit-terminal .
docker run --rm -p 8080:8080 orbit-terminal
# http://127.0.0.1:8080
```

The container uses an unprivileged Nginx server with CSP, anti-framing, MIME and referrer headers. Put it behind an HTTPS reverse proxy, set a domain, configure TLS/HSTS at the proxy, and monitor RPC/contract health. No hosting account/domain/TLS credentials have been supplied, so no public deployment is claimed. The Docker package still requires an actual build/runtime test on a Docker-capable host.

Production readiness still requires the checklist in `DEPLOYMENT.md`: independent audit, real protocol integration, key management, backend-verified XP, market/indexer data, adversarial transaction/risk tests and external monitoring.
