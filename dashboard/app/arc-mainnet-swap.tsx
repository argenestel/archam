"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { ArrowDown, Check, ExternalLink, RefreshCw } from "lucide-react";
import { arcMainnet, arcMainnetRouteConfig, arcMainnetRouteConfigured } from "./arc-mainnet-config";
import { TokenPicker, type PickerToken } from "./token-picker";
import { TokenImage } from "./token-image";
import "./swap-picker.css";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
]);
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200);

const mainnetClient = arcMainnetRouteConfig.rpcUrl
  ? createPublicClient({ chain: arcMainnet, transport: http(arcMainnetRouteConfig.rpcUrl) })
  : undefined;

const stablecoins: PickerToken[] = [
  { address: arcMainnetRouteConfig.usdcAddress, name: "USD Coin", symbol: "USDC", decimals: 6, image: "/token-images/usdc.svg", status: "route" as const, statusLabel: "Direct route" },
  { address: arcMainnetRouteConfig.eurcAddress, name: "Euro Coin", symbol: "EURC", decimals: 6, image: "/token-images/eurc.svg", status: "route" as const, statusLabel: "Direct route" },
].filter(token => !!token.address).map(token => ({ ...token, address: token.address! }));

function amountOf(value: string, decimals: number) {
  try {
    return new RegExp(`^\\d+(\\.\\d{1,${Math.min(decimals, 36)}})?$`).test(value) && parseUnits(value, decimals) > 0n
      ? parseUnits(value, decimals)
      : undefined;
  } catch {
    return undefined;
  }
}

function uniqueTokens(tokens: PickerToken[]) {
  const unique = new Map<string, PickerToken>();
  for (const token of tokens) unique.set(token.address.toLowerCase(), token);
  return [...unique.values()];
}

async function findBestRoute(amountIn: bigint, from: Address, to: Address) {
  if (!mainnetClient) throw new Error("Arc Mainnet RPC is not configured.");
  if (from.toLowerCase() === to.toLowerCase()) throw new Error("Choose two different tokens.");
  const bridges = [arcMainnetRouteConfig.usdcAddress, arcMainnetRouteConfig.eurcAddress]
    .filter((address): address is Address => !!address)
    .filter(address => address.toLowerCase() !== from.toLowerCase() && address.toLowerCase() !== to.toLowerCase());
  const paths = [[from, to], ...bridges.map(bridge => [from, bridge, to])];
  const routes = await Promise.all(paths.map(async path => {
    try {
      const amounts = await mainnetClient.readContract({
        address: arcMainnetRouteConfig.routerAddress!,
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [amountIn, path],
      });
      const output = amounts.at(-1) ?? 0n;
      return output > 0n ? { path, output } : undefined;
    } catch {
      return undefined;
    }
  }));
  const usable = routes.filter((route): route is { path: Address[]; output: bigint } => !!route);
  usable.sort((a, b) => (a.output > b.output ? -1 : a.output < b.output ? 1 : 0));
  if (!usable[0]) throw new Error("No live Arc Mainnet router path is available for these tokens.");
  return usable[0];
}

export function ArcMainnetSwap({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { address, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const lock = useRef(false);
  const [fromAddress, setFromAddress] = useState<Address>(arcMainnetRouteConfig.usdcAddress ?? zeroAddress);
  const [toAddress, setToAddress] = useState<Address>(arcMainnetRouteConfig.eurcAddress ?? zeroAddress);
  const [importedTokens, setImportedTokens] = useState<PickerToken[]>([]);
  const [pickerTarget, setPickerTarget] = useState<"from" | "to">();
  const [amount, setAmount] = useState("1");
  const [slippage, setSlippage] = useState("50");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();

  const tokens = uniqueTokens([...stablecoins, ...importedTokens]);
  const fallbackFrom: PickerToken = { address: zeroAddress, name: "Input token", symbol: "TOKEN", decimals: 18, image: "/token-images/default.svg" };
  const fallbackTo: PickerToken = { address: zeroAddress, name: "Output token", symbol: "TOKEN", decimals: 18, image: "/token-images/default.svg" };
  const from = tokens.find(token => token.address.toLowerCase() === fromAddress.toLowerCase()) ?? fallbackFrom;
  const to = tokens.find(token => token.address.toLowerCase() === toAddress.toLowerCase()) ?? fallbackTo;
  const routeConfigReady = arcMainnetRouteConfigured && !!mainnetClient;
  const differentTokens = from.address.toLowerCase() !== to.address.toLowerCase();
  const routeReady = routeConfigReady && differentTokens;
  const amountIn = amountOf(amount, from.decimals);

  const quote = useQuery({
    queryKey: ["arc-mainnet-swap-quote", from.address, to.address, amount],
    enabled: routeReady && !!amountIn,
    retry: 2,
    retryDelay: attempt => Math.min(1_000 * 2 ** attempt, 4_000),
    refetchInterval: 10_000,
    queryFn: () => findBestRoute(amountIn!, from.address, to.address),
  });

  const balance = useQuery({
    queryKey: ["arc-mainnet-swap-balance", address, from.address],
    enabled: routeReady && !!address,
    refetchInterval: 10_000,
    queryFn: () => mainnetClient!.readContract({ address: from.address, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
  });

  const outputText = quote.data ? formatUnits(quote.data.output, to.decimals) : "—";
  const insufficient = !!amountIn && balance.data !== undefined && balance.data < amountIn;
  const thinQuote = !!amountIn && !!quote.data && quote.data.output * 10n ** BigInt(from.decimals) < amountIn * 10n ** BigInt(to.decimals);

  async function importMainnetToken(value: string): Promise<PickerToken> {
    if (!mainnetClient) throw new Error("Arc Mainnet RPC is not configured.");
    if (!isAddress(value)) throw new Error("Enter a valid ERC-20 contract address.");
    const tokenAddress = getAddress(value);
    if ((await mainnetClient.getCode({ address: tokenAddress })) === "0x") throw new Error("That address has no contract code on Arc Mainnet.");
    const [name, symbol, decimals] = await Promise.all([
      mainnetClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" }),
      mainnetClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
      mainnetClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (decimals > 36) throw new Error("This token reports unsupported precision.");
    const token: PickerToken = { address: tokenAddress, name: name || "Unnamed token", symbol: symbol || "TOKEN", decimals, image: "/token-images/default.svg", status: "route", statusLabel: "Router route" };
    setImportedTokens(previous => uniqueTokens([...previous, token]));
    return token;
  }

  function selectToken(token: PickerToken) {
    if (pickerTarget === "from") setFromAddress(token.address);
    if (pickerTarget === "to") setToAddress(token.address);
    setPickerTarget(undefined);
    setError("");
    setMessage("");
  }

  async function walletContext() {
    if (!address || !connector) throw new Error("Connect your wallet to continue.");
    await switchChainAsync({ chainId: arcMainnet.id });
    const wallet = createWalletClient({ account: address, chain: arcMainnet, transport: custom((await connector.getProvider()) as EIP1193Provider) });
    const [walletAddresses, walletChain] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
    if (walletAddresses[0]?.toLowerCase() !== address.toLowerCase() || walletChain !== arcMainnet.id) throw new Error("Wallet account or network changed. Reconnect on Arc Mainnet.");
    return wallet;
  }

  async function confirm(tx: Hash) {
    if (!mainnetClient) throw new Error("Arc Mainnet RPC is not configured.");
    setHash(tx);
    setMessage("Transaction submitted. Waiting for Arc finality…");
    const receipt = await mainnetClient.waitForTransactionReceipt({ hash: tx });
    setHash(receipt.transactionHash);
    if (receipt.status !== "success") throw new Error("Transaction reverted. No swap was applied.");
  }

  async function run(action: () => Promise<void>) {
    if (!address) { openConnectModal?.(); return; }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("Review the request in your wallet…");
    setHash(undefined);
    try { await action(); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "Swap could not complete.");
      setMessage("Request not completed. Check any submitted transaction before retrying.");
    }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }

  async function swap() {
    if (!mainnetClient || !routeReady || !amountIn || !quote.data || quote.isError) throw new Error("Review a valid mainnet quote first.");
    if (insufficient) throw new Error(`Insufficient ${from.symbol} balance.`);
    const wallet = await walletContext();
    const fresh = await findBestRoute(amountIn, from.address, to.address);
    const minimumOut = (fresh.output * (10_000n - BigInt(slippage))) / 10_000n;
    const allowance = await mainnetClient.readContract({ address: from.address, abi: erc20Abi, functionName: "allowance", args: [address!, arcMainnetRouteConfig.routerAddress!] });
    if (allowance < amountIn) {
      setMessage(`Approve ${from.symbol} for the ArcSwap router in your wallet…`);
      const { request } = await mainnetClient.simulateContract({ account: address!, address: from.address, abi: erc20Abi, functionName: "approve", args: [arcMainnetRouteConfig.routerAddress!, amountIn] });
      await confirm(await wallet.writeContract(request));
    }
    const [walletAddresses, walletChain] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
    if (walletAddresses[0]?.toLowerCase() !== address!.toLowerCase() || walletChain !== arcMainnet.id) throw new Error("Wallet account or network changed. Review the swap again.");
    const { request } = await mainnetClient.simulateContract({
      account: address!,
      address: arcMainnetRouteConfig.routerAddress!,
      abi: routerAbi,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, minimumOut, fresh.path, address!, deadline()],
    });
    await confirm(await wallet.writeContract(request));
    setMessage(`Swapped ${formatUnits(amountIn, from.decimals)} ${from.symbol} for approximately ${formatUnits(fresh.output, to.decimals)} ${to.symbol}.`);
    void balance.refetch();
  }

  function reverse() {
    setFromAddress(to.address);
    setToAddress(from.address);
    setMessage("");
    setError("");
    setHash(undefined);
  }

  return (
    <section className="mainnet-swap-workspace" aria-label="Arc Mainnet token swap">
      <div className="ob-heading">
        <div>
          <span className="eyebrow">Arc Mainnet · ArcSwap DEX</span>
          <h2>Swap tokens</h2>
          <p>Direct or one-hop execution through the verified mainnet router.</p>
        </div>
        <span className="mainnet-swap-network"><i /> Chain 5042</span>
      </div>

      {!routeConfigReady ? (
        <div className="mainnet-route-empty"><strong>Mainnet route configuration is incomplete.</strong><span>Set the explicit RPC, router, factory, USDC, and EURC values before trading.</span></div>
      ) : !differentTokens ? (
        <div className="mainnet-route-empty"><strong>Choose two different tokens.</strong><span>The router needs a distinct input and output asset.</span></div>
      ) : (
        <>
          <div className="glass-panel mainnet-swap-card">
            <div className="mainnet-swap-fields">
              <label>
                <span className="mainnet-field-label">You pay <small>Balance: {balance.data === undefined ? "—" : formatUnits(balance.data, from.decimals)} {from.symbol}</small></span>
                <div className="mainnet-amount-row">
                  <input aria-label="Mainnet swap amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
                  <button type="button" className="mainnet-token-button" aria-label="Choose mainnet input token" onClick={() => setPickerTarget("from")} disabled={busy}><TokenImage src={from.image} name={from.name} size={24} /><span>{from.symbol}</span><span aria-hidden>⌄</span></button>
                </div>
              </label>
              <button type="button" className="mainnet-reverse" aria-label="Reverse mainnet swap direction" onClick={reverse} disabled={busy}><ArrowDown size={16} /></button>
              <label>
                <span className="mainnet-field-label">You receive <small>Live router quote</small></span>
                <div className="mainnet-receive-row">
                  <button type="button" className="mainnet-token-button" aria-label="Choose mainnet output token" onClick={() => setPickerTarget("to")} disabled={busy}><TokenImage src={to.image} name={to.name} size={24} /><span>{to.symbol}</span><span aria-hidden>⌄</span></button>
                  <strong>{outputText}</strong>
                </div>
              </label>
            </div>

            <div className="mainnet-swap-summary">
              <span><small>Route</small><b>{quote.data ? quote.data.path.map(tokenAddress => tokens.find(token => token.address.toLowerCase() === tokenAddress.toLowerCase())?.symbol ?? `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`).join(" → ") : `${from.symbol} → ${to.symbol}`}</b></span>
              <span><small>Minimum received</small><b>{quote.data ? formatUnits((quote.data.output * (10_000n - BigInt(slippage))) / 10_000n, to.decimals) : "—"} {to.symbol}</b></span>
              <label><small>Slippage</small><select value={slippage} onChange={event => setSlippage(event.target.value)}><option value="25">0.25%</option><option value="50">0.50%</option><option value="100">1.00%</option></select></label>
            </div>

            {quote.isError && <p className="mainnet-swap-error" role="alert">{quote.error instanceof Error ? quote.error.message : "Quote unavailable."}</p>}
            {insufficient && <p className="mainnet-swap-error" role="alert">Insufficient {from.symbol} balance for this amount.</p>}
            {thinQuote && <p className="mainnet-swap-warning" role="note">Thin liquidity: the live pool quote is unusually low. Review the output carefully before signing.</p>}
            <button className="btn-primary mainnet-swap-submit" disabled={busy || !address || !amountIn || !quote.data || quote.isError || quote.isFetching || insufficient} onClick={() => void run(swap)}>{busy ? "Confirming swap…" : !address ? "Connect wallet" : quote.isFetching ? "Refreshing quote…" : "Swap on Arc Mainnet"}</button>
            <p className="mainnet-swap-note"><RefreshCw size={12} /> Quote refreshes every 10 seconds. Approval and swap are separate wallet confirmations.</p>
          </div>
          <TokenPicker open={!!pickerTarget} onOpenChange={open => { if (!open) setPickerTarget(undefined); }} busy={busy} title="Choose an Arc Mainnet token" description="Direct and one-hop paths use the verified ArcSwap router. Imported tokens are quoted live before execution." networkLabel="Arc Mainnet" tokens={tokens} selected={pickerTarget === "from" ? from.address : to.address} onSelect={selectToken} onImport={importMainnetToken} />
        </>
      )}

      {(message || error) && <p className={`mainnet-swap-status ${error ? "error" : ""}`} role="status">{error || message}{!error && message.includes("Swapped") && <Check size={14} />}</p>}
      {hash && arcMainnetRouteConfig.explorerUrl && <a className="v2-address" href={`${arcMainnetRouteConfig.explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction on ArcScan <ExternalLink size={13} /></a>}
    </section>
  );
}
