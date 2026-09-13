"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Card, Flex, Text, TextField, SegmentedControl, Callout, Separator } from "@radix-ui/themes";
import { ChevronDown, Search } from "lucide-react";
import { createWalletClient, custom, isAddress, parseUnits, type EIP1193Provider, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { arcClient, readTokens, money, unit, useMarketAddresses, type MarketToken } from "./market-data";
import { curveToken } from "./generated/curveToken";
import { curveLaunchpad } from "./generated/curveLaunchpad";
import { wholeTokens, protectedAmount, withinProtection } from "./curve-swap-safety";
import { FormDialog } from "./form-dialog";
import { OnchainTokenImage, TokenImage } from "./token-image";
import { discoverArcTokens } from "./arc-token-discovery";
import "./swap-picker.css";

/** Domain flow using Radix controls; execution stays on the reserve-backed curve. */
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
  const [selected, setSelected] = useState<MarketToken | undefined>(initialToken);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hash>();
  const quantity = wholeTokens(amount);
  const tokens = useQuery({
    queryKey: ["curve-swap-tokens", factory, page], enabled: isAddress(factory),
    queryFn: () => readTokens(factory, page), refetchInterval: 15000,
  });
  const discovered = useQuery({
    queryKey: ["arc-token-discovery"], enabled: pickerOpen, staleTime: 60000, retry: false,
    queryFn: () => discoverArcTokens(50),
  });
  const token = selected;
  const visibleTokens = useMemo(() => {
    const query = tokenSearch.trim().toLowerCase();
    return (tokens.data?.tokens ?? []).filter(item =>
      !query || `${item.name} ${item.symbol} ${item.address}`.toLowerCase().includes(query)
    );
  }, [tokenSearch, tokens.data?.tokens]);
  const discoveredTokens = useMemo(() => {
    const supported = new Set((tokens.data?.tokens ?? []).map(item => item.address.toLowerCase()));
    const query = tokenSearch.trim().toLowerCase();
    return (discovered.data ?? []).filter(item => !supported.has(item.address.toLowerCase()) && (!query || `${item.name} ${item.symbol} ${item.address}`.toLowerCase().includes(query)));
  }, [discovered.data, tokenSearch, tokens.data?.tokens]);
  const quote = useQuery({
    queryKey: ["curve-swap-quote", factory, token?.address, token?.index.toString(), side, amount, address],
    enabled: isAddress(factory) && !!token && !!quantity,
    retry: false, refetchInterval: 10000,
    queryFn: async () => {
      if (!isAddress(factory) || !token || !quantity) throw new Error("Select a coin and enter a whole-token amount.");
      // An incoming selection must still belong to the active market.
      const registered = await arcClient.readContract({ address: factory, abi: curveLaunchpad.abi, functionName: "tokens", args: [token.index] });
      if (registered.toLowerCase() !== token.address.toLowerCase()) throw new Error("This coin belongs to another market. Select a coin from the current market.");
      const value = await arcClient.readContract({ address: token.address, abi: curveToken.abi, functionName: side === "buy" ? "quoteBuy" : "quoteSell", args: [quantity] });
      return { value };
    },
  });
  const balance = useQuery({
    queryKey: ["curve-swap-balance", token?.address, address], enabled: !!token && !!address,
    refetchInterval: 10000,
    queryFn: async () => ({
      usdc: await arcClient.getBalance({ address: address! }),
      coin: await arcClient.readContract({ address: token!.address, abi: curveToken.abi, functionName: "balanceOf", args: [address!] }),
    }),
  });
  const limit = quote.data ? protectedAmount(quote.data.value, side) : undefined;

  async function swap() {
    if (!address || !connector) { openConnectModal?.(); return; }
    if (lock.current || !token || !quantity || limit === undefined || quote.isError) return;
    lock.current = true; setBusy(true); onBusy(true); setError(""); setHash(undefined);
    try {
      setMessage("Confirm the Arc Testnet connection in your wallet.");
      await switchChainAsync({ chainId: arcTestnet.id });
      const wallet = createWalletClient({ account: address, chain: arcTestnet, transport: custom(await connector.getProvider() as EIP1193Provider) });
      if ((await wallet.getAddresses())[0]?.toLowerCase() !== address.toLowerCase() || await wallet.getChainId() !== arcTestnet.id) throw new Error("Wallet changed. Reconnect on Arc Testnet.");
      const fresh = await quote.refetch();
      if (fresh.isError || !fresh.data) throw new Error("Could not refresh the quote. Check the market and try again.");
      if (!withinProtection(fresh.data.value, limit, side)) throw new Error("Price moved beyond 1%. Review the new quote before swapping.");
      const fees = await arcClient.estimateFeesPerGas();
      const block = await arcClient.getBlock();
      const base = { address: token.address, abi: curveToken.abi, account: address, maxFeePerGas: fees.maxFeePerGas > parseUnits("20", 9) ? fees.maxFeePerGas : parseUnits("20", 9), maxPriorityFeePerGas: fees.maxPriorityFeePerGas } as const;
      const args = [quantity, limit, block.timestamp + 120n] as const;
      setMessage("Review the swap in your wallet.");
      let tx: Hash;
      if (side === "buy") {
        const { request } = await arcClient.simulateContract({ ...base, functionName: "buy", args, value: limit });
        tx = await wallet.writeContract(request);
      } else {
        const { request } = await arcClient.simulateContract({ ...base, functionName: "sell", args });
        tx = await wallet.writeContract(request);
      }
      setHash(tx); setMessage("Swap submitted. Waiting for confirmation…");
      let replaced = false;
      const receipt = await arcClient.waitForTransactionReceipt({ hash: tx, onReplaced: event => { setHash(event.transactionReceipt.transactionHash); if (event.reason !== "repriced") replaced = true; } });
      setHash(receipt.transactionHash);
      if (replaced || receipt.status !== "success") throw new Error("Swap was cancelled, replaced, or reverted. Check the transaction before trying again.");
      setMessage(`Swapped ${side === "buy" ? "USDC for" : "to USDC from"} ${quantity.toLocaleString()} ${token.symbol}.`);
      await cache.invalidateQueries({ predicate: query => /^(curve-|portfolio-|orderbook)/.test(String(query.queryKey[0])) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap could not complete. Check your wallet and transaction history.");
      setMessage("");
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  }

  return (
    <div className="curve-swap">
      <Card>
        <Flex direction="column" gap="4">
          <Text size="4" weight="bold">A simple curve swap</Text>
          <Text size="2" color="gray">Swap native USDC with coins from your selected launch market. The curve sets the price; no order matching needed.</Text>
          {!isAddress(factory) ? <Callout.Root><Callout.Text>Choose a launch market before swapping coins.</Callout.Text></Callout.Root> : <>
            <div className="swap-token-field">
              <span className="swap-field-label">Coin</span>
              <button type="button" role="combobox" aria-label="Coin" aria-expanded={pickerOpen} aria-controls="legacy-token-options" className="token-picker-trigger" disabled={busy} onClick={() => setPickerOpen(true)}>
                {token ? <><OnchainTokenImage address={token.address} name={token.name} size={28} /><span>{token.name} ({token.symbol})</span></> : <span>{tokens.isPending ? "Loading coins…" : "Choose a launched coin"}</span>}
                <ChevronDown size={16} />
              </button>
            </div>
            <FormDialog open={pickerOpen} onOpenChange={setPickerOpen} busy={busy} title="Select a coin" description="Choose a listed token from this Arc launch market.">
              <div className="token-picker-search"><Search size={15} /><input aria-label="Search coins" value={tokenSearch} onChange={event => setTokenSearch(event.target.value)} placeholder="Search by name, ticker, or address" /></div>
              <div id="legacy-token-options" className="token-picker-list" role="listbox" aria-label="Available coins">
                {visibleTokens.map(item => <button role="option" aria-label={`${item.name} (${item.symbol})`} aria-selected={item.address === token?.address} className="token-picker-item" key={item.address} onClick={() => { setSelected(item); setError(""); setMessage(""); setTokenSearch(""); setPickerOpen(false); }}>
                  <OnchainTokenImage address={item.address} name={item.name} size={38} /><span><strong>{item.name}</strong><small>{item.symbol} · {item.address.slice(0, 6)}…{item.address.slice(-4)}</small></span><ChevronDown size={14} className="token-picker-arrow" />
                </button>)}
                {discoveredTokens.length > 0 && <p className="token-picker-section">Detected on Arc Testnet</p>}
                {discoveredTokens.map(item => <button role="option" aria-selected="false" aria-disabled="true" className="token-picker-item token-picker-item-disabled" key={item.address} disabled title="This token is detected but has no Mofu curve route">
                  <TokenImage src={item.image} name={item.name} size={38} /><span><strong>{item.name}</strong><small>{item.symbol} · detected · no Mofu route</small></span>
                </button>)}
                {discovered.isError && <p className="token-picker-empty">Arc discovery is unavailable. Listed market coins are still available.</p>}
                {!visibleTokens.length && !discoveredTokens.length && <p className="token-picker-empty">No coins match your search.</p>}
              </div>
            </FormDialog>
            {tokens.isError && <Callout.Root color="red"><Callout.Text>Could not load coins. <Button variant="soft" onClick={() => void tokens.refetch()}>Retry</Button></Callout.Text></Callout.Root>}
            {tokens.data?.count === 0n && <Text size="2">No coins yet. Launch one to get started.</Text>}
            {tokens.data && tokens.data.count > 20n && <Flex justify="between"><Button variant="soft" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Newer coins</Button><Button variant="soft" disabled={busy || BigInt((page + 1) * 20) >= tokens.data.count} onClick={() => setPage(page + 1)}>Older coins</Button></Flex>}
            <SegmentedControl.Root value={side} onValueChange={value => setSide(value as "buy" | "sell")} disabled={busy}>
              <SegmentedControl.Item value="buy">USDC to coin</SegmentedControl.Item>
              <SegmentedControl.Item value="sell">Coin to USDC</SegmentedControl.Item>
            </SegmentedControl.Root>
            <Flex direction="column" gap="2">
              <Text as="label" size="2" htmlFor="coin-quantity">{side === "buy" ? "You receive" : "You send"} (whole {token?.symbol ?? "tokens"})</Text>
              <TextField.Root id="coin-quantity" size="3" value={amount} inputMode="numeric" disabled={busy} onChange={e => setAmount(e.target.value)} />
              {!quantity && <Text size="2" color="red">Enter 1–1,000,000 whole tokens.</Text>}
              {address && token && <Text size="2" color="gray">Wallet: {balance.data ? `${(balance.data.coin / unit).toLocaleString()} ${token.symbol} / ${money(balance.data.usdc)} USDC` : balance.isError ? "Balance unavailable" : "Loading balance…"}</Text>}
            </Flex>
            <Separator size="4" />
            <Flex justify="between"><Text>{side === "buy" ? "Estimated payment" : "Estimated receipt"}</Text><Text weight="bold">{quote.data && !quote.isError ? `${money(quote.data.value)} USDC` : "—"}</Text></Flex>
            <Text size="2" color="gray">{limit !== undefined && !quote.isError ? `${side === "buy" ? "Maximum payment" : "Minimum receipt"}: ${money(limit)} USDC. ` : ""}1% price protection. Gas is paid separately in USDC.</Text>
            {quote.isError && <Callout.Root color="red"><Callout.Text>Quote unavailable. Check the amount and coin: buys cannot exceed the supply cap, and sells cannot exceed minted supply.</Callout.Text></Callout.Root>}
            <Button size="3" loading={busy} disabled={!!address && (!token || !quantity || limit === undefined || quote.isError || quote.isFetching || (side === "sell" && balance.data !== undefined && quantity * unit > balance.data.coin))} onClick={() => void swap()}>{address ? "Confirm swap" : "Connect wallet"}</Button>
            {side === "sell" && quantity && balance.data && quantity * unit > balance.data.coin && <Text color="red" size="2">Not enough tokens in your wallet.</Text>}
          </>}
          <Flex gap="3" wrap="wrap"><Button variant="soft" disabled={busy} onClick={onLaunch}>Launch a coin</Button>{token && <Button variant="ghost" disabled={busy} onClick={() => onTrade(token)}>Place a limit order</Button>}</Flex>
          {(message || error) && <Callout.Root color={error ? "red" : "green"} role="status"><Callout.Text>{error || message}</Callout.Text></Callout.Root>}
          {hash && <a href={`https://testnet.arcscan.app/tx/${hash}`} target="_blank" rel="noreferrer">View transaction on ArcScan</a>}
        </Flex>
      </Card>
    </div>
  );
}
