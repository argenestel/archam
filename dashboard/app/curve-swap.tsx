"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Callout, Card, Separator, Text, TextField } from "@radix-ui/themes";
import { ArrowDown, ChevronDown, ExternalLink, LoaderCircle, Search } from "lucide-react";
import {
  createWalletClient,
  custom,
  isAddress,
  parseUnits,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { arcTestnet } from "viem/chains";
import { arcClient, money, readTokens, unit, useMarketAddresses, type MarketToken } from "./market-data";
import { curveLaunchpad } from "./generated/curveLaunchpad";
import { curveToken } from "./generated/curveToken";
import { wholeTokens, protectedAmount, withinProtection } from "./curve-swap-safety";
import {
  ARC_USDC,
  curatedArcTokens,
  discoverArcTokens,
  readArcToken,
  type DiscoveredArcToken,
} from "./arc-token-discovery";
import { OnchainTokenImage, TokenImage } from "./token-image";
import { TokenPicker, type PickerToken } from "./token-picker";
import "./swap-picker.css";

type SwapToken = PickerToken & { index?: bigint; source: "legacy" | "detected" | "imported" | "quote" };

const usdc: SwapToken = {
  address: ARC_USDC,
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  image: "/token-images/usdc.svg",
  status: "quote",
  statusLabel: "Quote asset",
  source: "quote",
};

function legacyOption(token: MarketToken): SwapToken {
  return {
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    decimals: 18,
    image: token.image,
    status: "route",
    statusLabel: "Legacy curve",
    source: "legacy",
    index: token.index,
  };
}

function discoveredOption(token: DiscoveredArcToken): SwapToken {
  return {
    ...token,
    status: "detected",
    statusLabel: "Detected · no route",
    source: token.source === "imported" ? "imported" : "detected",
  };
}

function uniqueTokens(tokens: SwapToken[]) {
  const unique = new Map<string, SwapToken>();
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    if (!unique.has(key)) unique.set(key, token);
  }
  return [...unique.values()];
}

/** Simple reserve-backed legacy swap. Legacy coins intentionally never graduate. */
export function CurveSwap({ initialToken, onBusy, onLaunch, onTrade }: {
  initialToken?: MarketToken;
  onBusy: (value: boolean) => void;
  onLaunch: () => void;
  onTrade: (token: MarketToken) => void;
}) {
  const { factory } = useMarketAddresses();
  const { address, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<SwapToken | undefined>(initialToken ? legacyOption(initialToken) : undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [importedTokens, setImportedTokens] = useState<SwapToken[]>([]);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hash>();
  const quantity = wholeTokens(amount);
  const hasLegacyMarket = isAddress(factory);

  const tokens = useQuery({
    queryKey: ["curve-swap-tokens", factory, page],
    enabled: hasLegacyMarket,
    queryFn: () => readTokens(factory, page),
    refetchInterval: 15000,
  });
  const discovered = useQuery({
    queryKey: ["arc-token-discovery"],
    enabled: pickerOpen,
    staleTime: 60000,
    retry: false,
    queryFn: () => discoverArcTokens(80),
  });

  const pickerTokens = useMemo(() => {
    const registered = (tokens.data?.tokens ?? []).map(legacyOption);
    const detected = (discovered.data ?? curatedArcTokens).map(discoveredOption);
    return uniqueTokens([usdc, ...registered, ...detected, ...importedTokens]);
  }, [discovered.data, importedTokens, tokens.data?.tokens]);
  const token = selected;
  const routeAvailable = token?.source === "legacy" && token.index !== undefined;
  const quote = useQuery({
    queryKey: ["curve-swap-quote", factory, token?.address, token?.index?.toString(), side, amount, address],
    enabled: hasLegacyMarket && routeAvailable && !!quantity,
    retry: false,
    refetchInterval: 10000,
    queryFn: async () => {
      if (!hasLegacyMarket || !token || token.index === undefined || !quantity) {
        throw new Error("Select a legacy coin and enter a whole-token amount.");
      }
      const registered = await arcClient.readContract({
        address: factory,
        abi: curveLaunchpad.abi,
        functionName: "tokens",
        args: [token.index],
      });
      if (registered.toLowerCase() !== token.address.toLowerCase()) {
        throw new Error("This coin belongs to another market. Select a coin from the current market.");
      }
      const value = await arcClient.readContract({
        address: token.address,
        abi: curveToken.abi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [quantity],
      });
      return { value };
    },
  });
  const balance = useQuery({
    queryKey: ["curve-swap-balance", token?.address, address],
    enabled: routeAvailable && !!address,
    refetchInterval: 10000,
    queryFn: async () => ({
      usdc: await arcClient.getBalance({ address: address! }),
      coin: await arcClient.readContract({ address: token!.address, abi: curveToken.abi, functionName: "balanceOf", args: [address!] }),
    }),
  });
  const limit = quote.data ? protectedAmount(quote.data.value, side) : undefined;

  function selectToken(option: PickerToken) {
    if (option.address.toLowerCase() === ARC_USDC.toLowerCase()) {
      setError("USDC is the quote asset here. Choose a coin to trade against it.");
      return;
    }
    const next = option as SwapToken;
    setSelected(next);
    setError("");
    setMessage("");
    setPickerOpen(false);
  }

  async function importToken(addressInput: string) {
    const imported = discoveredOption(await readArcToken(addressInput));
    setImportedTokens(previous => uniqueTokens([...previous, imported]));
    return imported;
  }

  async function swap() {
    if (!address || !connector) {
      openConnectModal?.();
      return;
    }
    if (lock.current || !token || !routeAvailable || !quantity || limit === undefined || quote.isError) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setHash(undefined);
    try {
      setMessage("Confirm the Arc Testnet connection in your wallet.");
      await switchChainAsync({ chainId: arcTestnet.id });
      const wallet = createWalletClient({
        account: address,
        chain: arcTestnet,
        transport: custom(await connector.getProvider() as EIP1193Provider),
      });
      if ((await wallet.getAddresses())[0]?.toLowerCase() !== address.toLowerCase() || await wallet.getChainId() !== arcTestnet.id) {
        throw new Error("Wallet changed. Reconnect on Arc Testnet.");
      }
      const fresh = await quote.refetch();
      if (fresh.isError || !fresh.data) throw new Error("Could not refresh the quote. Check the market and try again.");
      if (!withinProtection(fresh.data.value, limit, side)) throw new Error("Price moved beyond 1%. Review the new quote before swapping.");
      const fees = await arcClient.estimateFeesPerGas();
      const block = await arcClient.getBlock();
      const base = {
        address: token.address,
        abi: curveToken.abi,
        account: address,
        maxFeePerGas: fees.maxFeePerGas > parseUnits("20", 9) ? fees.maxFeePerGas : parseUnits("20", 9),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      } as const;
      const args = [quantity, limit, block.timestamp + 120n] as const;
      setMessage("Review the swap in your wallet.");
      let transaction: Hash;
      if (side === "buy") {
        const { request } = await arcClient.simulateContract({ ...base, functionName: "buy", args, value: limit });
        transaction = await wallet.writeContract(request);
      } else {
        const { request } = await arcClient.simulateContract({ ...base, functionName: "sell", args });
        transaction = await wallet.writeContract(request);
      }
      setHash(transaction);
      setMessage("Swap submitted. Waiting for confirmation…");
      let replaced = false;
      const receipt = await arcClient.waitForTransactionReceipt({
        hash: transaction,
        onReplaced: event => {
          setHash(event.transactionReceipt.transactionHash);
          if (event.reason !== "repriced") replaced = true;
        },
      });
      setHash(receipt.transactionHash);
      if (replaced || receipt.status !== "success") throw new Error("Swap was cancelled, replaced, or reverted. Check the transaction before trying again.");
      setMessage(`Swapped ${side === "buy" ? "USDC for" : "to USDC from"} ${quantity.toLocaleString()} ${token.symbol}.`);
      await cache.invalidateQueries({ predicate: queryItem => /^(curve-|portfolio-|orderbook)/.test(String(queryItem.queryKey[0])) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Swap could not complete. Check your wallet and transaction history.");
      setMessage("");
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  const outputValue = quote.data && !quote.isError ? `${money(quote.data.value)} USDC` : "—";
  const amountLabel = side === "buy" ? "You receive" : "You send";
  const disabled = busy || !token || !routeAvailable || !quantity || limit === undefined || quote.isError || quote.isFetching;

  return (
    <section className="swap-page" aria-label="Legacy curve swap">
      <div className="swap-page-heading">
        <div>
          <span className="eyebrow">Arc Testnet · reserve-backed market</span>
          <h2>Swap a coin</h2>
          <p>Pick a coin, enter an amount, and review the exact curve quote before signing.</p>
        </div>
        <span className="swap-network-chip"><span /> Arc Testnet</span>
      </div>

      <Card className="swap-card">
        <div className="swap-card-topline">
          <div>
            <span className="swap-card-kicker">Legacy curve</span>
            <strong>{token ? token.symbol : "Choose a coin"}</strong>
          </div>
          <span className="swap-route-note">Legacy coins never graduate</span>
        </div>

        {!hasLegacyMarket ? (
          <Callout.Root color="gray">
            <Callout.Text>Choose or deploy a legacy launch market before swapping coins.</Callout.Text>
          </Callout.Root>
        ) : (
          <>
            <div className="swap-direction-toggle" aria-label="Swap direction">
              <button type="button" role="radio" aria-label="USDC to coin" aria-checked={side === "buy"} className={side === "buy" ? "active" : ""} disabled={busy} onClick={() => setSide("buy")}>Buy coin</button>
              <button type="button" role="radio" aria-label="Coin to USDC" aria-checked={side === "sell"} className={side === "sell" ? "active" : ""} disabled={busy} onClick={() => setSide("sell")}>Sell coin</button>
            </div>

            <div className="swap-field swap-field-quote">
              <div className="swap-field-heading"><span>{side === "buy" ? "You pay" : "You receive"}</span><span>USDC</span></div>
              <div className="swap-field-value">
                <strong>{outputValue}</strong>
                <span className="swap-asset-pill"><TokenImage src={usdc.image} size={24} /> USDC</span>
              </div>
            </div>

            <div className="swap-flip" aria-hidden="true"><span><ArrowDown size={16} /></span></div>

            <div className="swap-field swap-field-input">
              <div className="swap-field-heading">
                <label htmlFor="coin-quantity">{amountLabel}</label>
                {address && balance.data && <span>{side === "sell" ? `${(balance.data.coin / unit).toLocaleString()} ${token?.symbol ?? "coin"}` : `${money(balance.data.usdc)} USDC`}</span>}
              </div>
              <div className="swap-field-value">
                <TextField.Root id="coin-quantity" aria-label={amountLabel} size="3" value={amount} inputMode="numeric" disabled={busy} onChange={event => setAmount(event.target.value)} placeholder="0" />
                <button type="button" role="combobox" aria-label="Coin" aria-expanded={pickerOpen} aria-controls="legacy-token-options" className="swap-asset-pill swap-asset-button" disabled={busy} onClick={() => setPickerOpen(true)}>
                  {token ? <>{token.source === "legacy" ? <OnchainTokenImage address={token.address} name={token.name} size={24} /> : <TokenImage src={token.image} name={token.name} size={24} />}<span>{token.name} ({token.symbol})</span></> : <><TokenImage src="/token-images/default.svg" size={24} /><span>Choose coin</span></>}
                  <ChevronDown size={14} />
                </button>
              </div>
              {!quantity && <Text size="1" color="red">Enter 1–1,000,000 whole tokens.</Text>}
            </div>

            <TokenPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              busy={busy}
              title="Choose a coin"
              description="Available routes are listed first. Arc tokens without a Mofu route are detected and labeled honestly."
              tokens={pickerTokens}
              selected={token?.address}
              onSelect={selectToken}
              onImport={importToken}
            />

            {discovered.isError && <p className="swap-inline-note"><Search size={13} /> Arc token directory is unavailable; enter an address to detect a token directly.</p>}
            {token && !routeAvailable && (
              <Callout.Root color="gray" className="swap-no-route">
                <Callout.Text><strong>{token.symbol}</strong> is detected on Arc Testnet, but this app has no verified liquidity route for it yet. Choose a legacy coin or a V2 pool.</Callout.Text>
              </Callout.Root>
            )}
            {quote.isError && <Callout.Root color="red"><Callout.Text>Quote unavailable. Check the amount and coin: buys cannot exceed the supply cap, and sells cannot exceed your minted balance.</Callout.Text></Callout.Root>}

            <Separator size="4" />
            <div className="swap-summary">
              <span>{side === "buy" ? "Maximum payment" : "Minimum receipt"}</span>
              <strong>{limit !== undefined && !quote.isError ? `${money(limit)} USDC` : "—"}</strong>
            </div>
            <p className="swap-protection">1% price protection · gas is paid separately in native USDC · no graduation path for legacy coins</p>
            <Button size="3" className="swap-submit" loading={busy} disabled={disabled} onClick={() => void swap()}>
              {busy ? <><LoaderCircle size={16} className="spin" /> Confirming swap…</> : !address ? "Connect wallet" : !token ? "Choose a coin" : !routeAvailable ? "No route available" : "Confirm swap"}
            </Button>
          </>
        )}

        <div className="swap-card-actions">
          <Button variant="soft" disabled={busy} onClick={onLaunch}>Launch a legacy coin</Button>
          {token?.source === "legacy" && token.index !== undefined && <Button variant="ghost" disabled={busy} onClick={() => onTrade({ index: token.index!, address: token.address, name: token.name, symbol: token.symbol })}>Place a limit order</Button>}
        </div>
        {(message || error) && <Callout.Root color={error ? "red" : "green"} role="status"><Callout.Text>{error || message}</Callout.Text></Callout.Root>}
        {hash && <a className="swap-transaction-link" href={`https://testnet.arcscan.app/tx/${hash}`} target="_blank" rel="noreferrer">View transaction on ArcScan <ExternalLink size={13} /></a>}
      </Card>

      {tokens.data && tokens.data.count > 20n && <div className="swap-pager"><button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Newer coins</button><span>{tokens.data.count.toString()} coins in this market</span><button disabled={busy || BigInt((page + 1) * 20) >= tokens.data.count} onClick={() => setPage(page + 1)}>Older coins</button></div>}
    </section>
  );
}
