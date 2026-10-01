# Arc RPC connectivity

## Why `Failed to fetch` happened

The reported failure was a browser HTTP failure before a JSON-RPC response. The official RPC responded successfully from the development machine, so the exact user's DNS/CORS/VPN/browser failure was not reproduced. A functioning server-side endpoint does not guarantee the browser can reach it directly.

## Current request path

Browsers now call same-origin endpoints, with bounded timeout and fallback:

| Local path               | Upstream                               |
| ------------------------ | -------------------------------------- |
| `/api/arc-rpc`           | `https://rpc.testnet.arc.io`           |
| `/api/arc-rpc-quicknode` | `https://rpc.quicknode.testnet.arc.io` |
| `/api/arc-rpc-drpc`      | `https://rpc.drpc.testnet.arc.io`      |

All three are listed in the [official Arc connection reference](https://docs.arc.io/arc/references/connect-to-arc) and returned chain ID 5042002 when checked. Vite development/preview and the Nginx container proxy these paths. Wallet network configuration still contains public RPC URLs; local proxy URLs are never installed into the wallet.

Nginx uses fixed upstreams, POST-only proxy paths, a 64KB body limit, per-IP rate limits, TLS verification, and request timeouts. It is not an arbitrary URL forwarding service. No private keys or authenticated upstream API keys are involved.

The UI pauses trading during failed contract verification, presents a concise network error, supports **Retry connection**, and retries verification after an outage. It retains contract bytecode checks; connectivity recovery does not bypass them. Quotes and balances are refetched after reconnection. Raw request bodies/URLs/viem stack dumps are not displayed to users. Pool snapshots show stale status when their reads fail.

## Check locally

```sh
curl http://localhost:5191/api/arc-rpc \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# Expected result: 0x4cef52
```

Refresh the page after upgrading the app so the new transport code loads. If every proxy fails, check host connectivity to the listed upstreams and network restrictions. Do not disable TLS verification or contract checks.

Static-only hosting must provide these reverse-proxy routes; uploading `dist/` without API routes is insufficient. The Docker/Nginx hosting package includes them. Public production hosting and its TLS/domain still require an actual deployment target. The Docker daemon is unavailable in this environment, so the Nginx container build/runtime has not been validated here.

Browser tests use public runtime-code fixtures and simulated outages, not wallet keys. They test fallback, actionable offline messaging, recovery, and mobile layout deterministically. No transactions are sent by these tests.
