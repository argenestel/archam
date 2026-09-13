"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createWalletClient, custom, decodeEventLog, erc20Abi, formatUnits, isAddress, parseUnits, type Address, type EIP1193Provider, type Hash } from "viem";
import { arcTestnet } from "viem/chains";
import { arcClient, short } from "./market-data";
import { mofuFactoryV2 } from "./generated/mofuFactoryV2";
import { mofuTokenV2 } from "./generated/mofuTokenV2";
import { mofuPool } from "./generated/mofuPool";
import { ARC_USDC, quoteV2, readV2Market, readV2Token, saveV2Factory, useV2Factory } from "./v2-market";
import { FormDialog } from "./form-dialog";
import { TokenPicker, type PickerToken } from "./token-picker";
import { TokenImage, tokenArtwork, tokenImagePath } from "./token-image";
import "./v2.css";
import "./swap-picker.css";
import { curatedArcTokens, discoverArcTokens, readArcToken } from "./arc-token-discovery";

export function V2Launchpad({ onBusy, mode = "launch", hideFeatured = false }: { onBusy: (busy: boolean) => void; mode?: "launch" | "swap"; hideFeatured?: boolean }) {
 const factory = useV2Factory();
 const { address, connector } = useAccount();
 const { switchChainAsync } = useSwitchChain();
 const { openConnectModal } = useConnectModal();
 const cache = useQueryClient();
 const [modal, setModal] = useState<"launch" | "settings" | null>(null);
 const [ticketOpen, setTicketOpen] = useState(false);
 const [pickerOpen, setPickerOpen] = useState(false);
 const [selected, setSelected] = useState<Address>();
 const [externalToken, setExternalToken] = useState<PickerToken>();
 const [importedTokens, setImportedTokens] = useState<PickerToken[]>([]);
 const [page, setPage] = useState(0);
 const [side, setSide] = useState<"buy" | "sell">("buy");
 const [amount, setAmount] = useState("100");
 const [busy, setBusy] = useState(false);
 const lock = useRef(false);
 const [message, setMessage] = useState("");
 const [error, setError] = useState("");
 const [hash, setHash] = useState<Hash>();
 const [factoryInput, setFactoryInput] = useState("");
 const [name, setName] = useState("");
 const [symbol, setSymbol] = useState("");
 const [image, setImage] = useState(tokenImagePath(tokenArtwork[0]));
 const [quoteAsset, setQuoteAsset] = useState<string>(ARC_USDC);
 const [startPrice, setStartPrice] = useState("0.000001");
 const market = useQuery({queryKey:["v2-market",factory,page], enabled:isAddress(factory), queryFn:()=>readV2Market(factory,page), refetchInterval:15000});
 const visibleTokens = hideFeatured ? (market.data?.tokens ?? []).slice(1) : (market.data?.tokens ?? []);
 const discovered = useQuery({queryKey:["arc-token-discovery"], enabled:pickerOpen, staleTime:60000, retry:false, queryFn:()=>discoverArcTokens(80)});
 const pickerTokens = useMemo(() => {
  const supported = (market.data?.tokens ?? []).map(item => ({
   address: item.address,
   name: item.name,
   symbol: item.symbol,
   decimals: item.decimals,
   image: item.image,
   status: "route" as const,
   statusLabel: item.graduated ? "Pool live" : "Bonding curve",
  }));
  const supportedAddresses = new Set(supported.map(item => item.address.toLowerCase()));
  const detected = (discovered.data ?? curatedArcTokens)
   .filter(item => !supportedAddresses.has(item.address.toLowerCase()))
   .map(item => ({ ...item, status: "detected" as const, statusLabel: "Detected · no route" }));
  const all = [...supported, ...detected, ...importedTokens];
  return all.filter((item, index) => all.findIndex(candidate => candidate.address.toLowerCase() === item.address.toLowerCase()) === index);
 }, [discovered.data, importedTokens, market.data?.tokens]);
 const detail = useQuery({queryKey:["v2-token",selected], enabled:!!selected, queryFn:()=>readV2Token(selected!),refetchInterval:10000});
 const token = detail.data;
 let quantity: bigint | undefined;
 try {
  if (token?.graduated) {
   const decimals = side === "buy" ? token.decimals : 18;
   if (new RegExp("^\\d+(\\.\\d{1," + decimals + "})?$").test(amount)) quantity = parseUnits(amount, decimals);
  } else if (/^\d{1,7}$/.test(amount)) quantity = BigInt(amount);
  if (quantity !== undefined && quantity <= 0n) quantity = undefined;
 } catch { quantity = undefined; }
 const estimate = useQuery({
  queryKey:["v2-estimate",token?.address,token?.pool,side,amount], enabled:!!token && !!quantity, retry:false,
  queryFn:()=>quoteV2(token!,side,quantity!), refetchInterval:10000,
 });
 const balances = useQuery({
  queryKey:["v2-balances",token?.address,address], enabled:!!token && !!address, refetchInterval:10000,
  queryFn:async()=> ({
   token:await arcClient.readContract({address:token!.address,abi:erc20Abi,functionName:"balanceOf",args:[address!]}),
   quote:await arcClient.readContract({address:token!.quote,abi:erc20Abi,functionName:"balanceOf",args:[address!]}),
  }),
 });
 async function walletContext() {
  if (!address || !connector) throw new Error("Connect your wallet.");
  await switchChainAsync({chainId:arcTestnet.id});
  const wallet = createWalletClient({account:address,chain:arcTestnet,transport:custom(await connector.getProvider() as EIP1193Provider)});
  if (await wallet.getChainId() !== arcTestnet.id || (await wallet.getAddresses())[0]?.toLowerCase() !== address.toLowerCase()) throw new Error("Wallet account or network changed.");
  return wallet;
 }
 async function receipt(tx: Hash) {
  setHash(tx); setMessage("Transaction submitted. Waiting for confirmation…");
  let replaced = false;
  const result = await arcClient.waitForTransactionReceipt({hash:tx,onReplaced:event=>{setHash(event.transactionReceipt.transactionHash); if(event.reason !== "repriced") replaced = true;}});
  if (result.status !== "success" || replaced) throw new Error("Transaction reverted or was replaced. Check the transaction before retrying.");
  return result;
 }
 async function run(action: () => Promise<void>) {
  if (!address) { openConnectModal?.(); return; }
  if (lock.current) return;
  lock.current = true; setBusy(true); onBusy(true); setError(""); setMessage(""); setHash(undefined);
  try { await action(); await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith("v2-")}); }
  catch (e) { setError(e instanceof Error ? e.message : "Transaction failed."); setMessage(""); }
  finally { lock.current = false; setBusy(false); onBusy(false); }
 }
 async function deploy() {
  const wallet = await walletContext();
  setMessage("Confirm market deployment in your wallet.");
  const result = await receipt(await wallet.deployContract({abi:mofuFactoryV2.abi,bytecode:mofuFactoryV2.bytecode,args:[address!]}));
  if (!result.contractAddress) throw new Error("Deployment address unavailable.");
  saveV2Factory(result.contractAddress); setMessage("Graduating-token market deployed."); setModal(null);
 }
 async function launch() {
  if (!isAddress(factory) || !isAddress(quoteAsset)) throw new Error("Choose valid market and ERC-20 quote addresses.");
  const decimals = await arcClient.readContract({address:quoteAsset,abi:erc20Abi,functionName:"decimals"});
  if (!/^\d+(\.\d+)?$/.test(startPrice) || (startPrice.split(".")[1]?.length ?? 0) > decimals) throw new Error("Initial price exceeds the quote asset's precision.");
  const price = parseUnits(startPrice,decimals);
  if (price <= 0n) throw new Error("Initial price must be positive.");
  if (!/^https:\/\//.test(image) && !/^ipfs:\/\//.test(image) && !image.startsWith("/token-images/")) throw new Error("Choose a token image URL (HTTPS or IPFS).");
  const wallet = await walletContext();
  const {request} = await arcClient.simulateContract({account:address,address:factory,abi:mofuFactoryV2.abi,functionName:"createToken",args:[name,symbol,image,"",quoteAsset,price,false]});
  const result = await receipt(await wallet.writeContract(request));
  for(const log of result.logs) {
   try { const event = decodeEventLog({abi:mofuFactoryV2.abi,data:log.data,topics:log.topics});
    if(event.eventName === "TokenCreated" && log.address.toLowerCase() === factory.toLowerCase()) { setSelected(event.args.token); break; }
   } catch {}
  }
  setModal(null); setTicketOpen(true); setMessage("Token launched. Buy through the curve to reach graduation.");
 }
 function selectPickerToken(option: PickerToken) {
  const supported = market.data?.tokens.find(item => item.address.toLowerCase() === option.address.toLowerCase());
  if (supported) {
   setSelected(supported.address);
   setExternalToken(undefined);
   setAmount(supported.graduated ? "1" : "100");
  } else {
   setSelected(undefined);
   setExternalToken(option);
  }
  setError("");
  setPickerOpen(false);
 }
 async function importToken(addressInput: string) {
  const token = await readArcToken(addressInput);
  const option: PickerToken = { ...token, status: "detected", statusLabel: "Detected · no route" };
  setImportedTokens(previous => previous.some(item => item.address.toLowerCase() === option.address.toLowerCase()) ? previous : [...previous, option]);
  return option;
 }
 async function swap() {
  if(!token || !quantity || estimate.data === undefined || estimate.isError) throw new Error("Review a valid quote first.");
  const originalPool = token.pool;
  const maxPayment = !token.graduated && side === "buy";
  const limit = maxPayment ? (estimate.data * 101n + 99n) / 100n : estimate.data * 99n / 100n;
  if(limit <= 0n) throw new Error("Amount is too small for a protected swap.");
  const wallet = await walletContext();
  const spender = token.graduated ? token.pool : token.address;
  const asset = side === "buy" ? token.quote : token.address;
  const approval = maxPayment ? limit : quantity;
  if(token.graduated || side === "buy") {
   const allowance = await arcClient.readContract({address:asset,abi:erc20Abi,functionName:"allowance",args:[address!,spender]});
   if(allowance < approval) {
    setMessage("Approve the displayed amount in your wallet.");
    const {request} = await arcClient.simulateContract({account:address,address:asset,abi:erc20Abi,functionName:"approve",args:[spender,approval]});
    await receipt(await wallet.writeContract(request));
   }
  }
  if((await wallet.getAddresses())[0]?.toLowerCase() !== address!.toLowerCase() || await wallet.getChainId() !== arcTestnet.id) throw new Error("Wallet changed. Review again.");
  const fresh = await readV2Token(token.address);
  if(fresh.pool !== originalPool) throw new Error("Token just graduated. Review the pool quote before swapping.");
  const current = await quoteV2(fresh,side,quantity);
  if(maxPayment ? current > limit : current < limit) throw new Error("Price moved beyond 1%. Review a new quote.");
  if(token.graduated) {
   const {request} = await arcClient.simulateContract({account:address,address:token.pool,abi:mofuPool.abi,functionName:side === "buy" ? "swapQuoteForToken" : "swapTokenForQuote",args:[quantity,limit]});
   await receipt(await wallet.writeContract(request));
  } else {
   const {request} = await arcClient.simulateContract({account:address,address:token.address,abi:mofuTokenV2.abi,functionName:side === "buy" ? "buy" : "sell",args:[quantity,limit]});
   await receipt(await wallet.writeContract(request));
  }
  const updated = await readV2Token(token.address);
  setMessage(updated.graduated && !token.graduated ? "Token graduated. Pool created and liquidity locked. Pool swaps are now available." : token.graduated ? "Pool swap confirmed." : "Curve trade confirmed.");
  if(updated.graduated && !token.graduated) setAmount("1");
 }
 const estimatedDecimals = token?.graduated && side === "buy" ? 18 : token?.decimals ?? 6;
 const ticket = (<div className="glass-panel v2-ticket">
     {mode === "swap" && <>
      <button type="button" role="combobox" aria-label="V2 coin" aria-expanded={pickerOpen} aria-controls="v2-token-options" className="token-picker-trigger" disabled={busy} onClick={()=>setPickerOpen(true)}>
       {token ? <><TokenImage src={token.image} name={token.name} size={28}/><span>{token.name} ({token.symbol})</span></> : externalToken ? <><TokenImage src={externalToken.image} name={externalToken.name} size={28}/><span>{externalToken.name} ({externalToken.symbol})</span></> : <span>Select a token</span>}<span aria-hidden>⌄</span>
      </button>
      <TokenPicker open={pickerOpen} onOpenChange={setPickerOpen} busy={busy} title="Choose a token" description="V2 routes use the bonding curve first, then a permanently locked pool after graduation." tokens={pickerTokens} selected={token?.address ?? externalToken?.address} onSelect={selectPickerToken} onImport={importToken} />
     </>}
     {!selected && !externalToken ? <p>Select a token to buy, sell, or inspect its pool.</p> : externalToken ? <div className="v2-detected-token"><TokenImage src={externalToken.image} name={externalToken.name} size={56}/><h3>{externalToken.name} ({externalToken.symbol})</h3><p>Detected on Arc Testnet, but no verified Mofu curve or pool route is available yet.</p></div> : !token ? <p>{detail.isError ? "Token could not be loaded." : "Loading token…"}</p> : <>
      <div className="v2-token-title"><TokenImage src={token.image} name={token.name} size={48}/><div><h3>{token.name}</h3><p>{token.graduated ? "Pool live" : "Bonding curve"}</p></div></div>
      <a className="v2-address" href={`https://testnet.arcscan.app/token/${token.address}`} target="_blank" rel="noreferrer">{short(token.address)} ↗</a>
      {token.graduated ? <a className="v2-address" href={`https://testnet.arcscan.app/address/${token.pool}`} target="_blank" rel="noreferrer">Pool: {short(token.pool)} · liquidity locked ↗</a> : <p>{(token.cap-token.sold).toLocaleString()} tokens until graduation</p>}
      <fieldset disabled={busy}>
       <div className="ob-toggle"><button className={side === "buy" ? "active" : ""} onClick={()=>setSide("buy")}>Buy</button><button className={side === "sell" ? "active" : ""} onClick={()=>setSide("sell")}>Sell</button></div>
       <label>Trade amount {token.graduated ? `(${side === "buy" ? token.quoteSymbol : token.symbol} sent)` : "(whole tokens)"}<input aria-label="V2 trade amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
       {!token.graduated && side === "buy" && <button className="btn-secondary" onClick={()=>setAmount(String(token.cap-token.sold))}>Fill remaining curve</button>}
       <p>Estimated {token.graduated || side === "sell" ? "receipt" : "payment"}: {estimate.data !== undefined && !estimate.isError ? formatUnits(estimate.data,estimatedDecimals) : "—"} {token.graduated && side === "buy" ? token.symbol : token.quoteSymbol}</p>
       <p className="v2-note">1% trading fee included. 1% price protection. Gas is separate.</p>
       {balances.data && <p className="v2-note">Wallet: {formatUnits(balances.data.token,18)} {token.symbol} / {formatUnits(balances.data.quote,token.decimals)} {token.quoteSymbol}</p>}
       {estimate.isError && <p role="alert">Quote unavailable. Check the amount and available liquidity.</p>}
       <button className="btn-primary" disabled={busy || (!!address && (!quantity || estimate.data === undefined || estimate.isError || estimate.isFetching))} onClick={()=>void run(swap)}>{!address ? "Connect wallet" : token.graduated ? "Confirm pool swap" : "Confirm curve trade"}</button>
      </fieldset>
     </>}
    </div>);
 return <section className={`v2-workspace ${mode === "swap" ? "v2-swap-mode" : ""}`} aria-label={mode === "swap" ? "Swap graduating tokens" : "Graduating tokens"}>
  <div className="ob-heading"><div><h2>{mode === "swap" ? "Swap" : hideFeatured ? "More graduating tokens" : "Graduating tokens"}</h2><p>{mode === "swap" ? "Curve or pool. One token at a time." : hideFeatured ? "The latest launch is featured above." : "Curve buyout creates a locked pool."}</p></div>
   {mode !== "swap" && <div className="v2-actions"><button className="btn-secondary" disabled={busy} onClick={()=>setModal("settings")}>V2 market settings</button><button className="btn-primary" disabled={busy || !isAddress(factory)} onClick={()=>setModal("launch")}>Launch graduating token</button></div>}
  </div>
  {!isAddress(factory) ? <div className="glass-panel v2-empty"><h3>Set up a graduating-token market</h3><p>Legacy coins cannot graduate. Deploy a V2 market or connect an existing one.</p><button className="btn-primary" disabled={busy} onClick={()=>setModal("settings")}>Set up market</button></div> :
   <div className="v2-columns">
    <div>
     {market.isPending && <p>Loading graduating tokens…</p>}
     {market.isError && <p role="alert">Could not load this V2 market. <button onClick={()=>void market.refetch()}>Retry</button></p>}
     {market.data?.count === 0n && <div className="glass-panel v2-empty">No graduating tokens yet. Launch the first token.</div>}
     {hideFeatured && visibleTokens.length === 0 && market.data && market.data.count > 0n && <div className="glass-panel v2-empty">The latest launch is featured above. Launch another token to grow the market.</div>}
     <div className="v2-token-grid">{visibleTokens.map(t=><button className="market-card v2-token-card" key={t.address} disabled={busy} aria-label={`Select graduating ${t.name}`} onClick={()=>{setSelected(t.address);setTicketOpen(true);setAmount(t.graduated ? "1" : "100");setError("");}}>
      <TokenImage src={t.image} name={t.name} size={64}/><h3>{t.name}</h3><span>{t.symbol} / {t.quoteSymbol}</span><p>{t.graduated ? "Graduated · pool live" : `${(Number(t.sold)*100/Number(t.cap)).toFixed(1)}% to graduation`}</p>
      <div className="progress-track"><div className="progress-fill" style={{width:`${Math.min(100,Number(t.sold)*100/Number(t.cap))}%`}}/></div>
     </button>)}</div>
     {market.data && market.data.count > 12n && <div className="v2-actions"><button disabled={busy || page === 0} onClick={()=>setPage(page-1)}>Newer</button><button disabled={busy || BigInt((page+1)*12)>=market.data.count} onClick={()=>setPage(page+1)}>Older</button></div>}
    </div>
    {mode === "swap" ? ticket : <FormDialog open={ticketOpen} onOpenChange={setTicketOpen} busy={busy} title={token?.name ?? "Token details"} description="Review the token and trade its curve or pool.">{ticket}</FormDialog>}
   </div>}
  {(message || error) && <p className="v2-status" role="status">{error || message}</p>}
  {hash && <a className="v2-address" target="_blank" rel="noreferrer" href={`https://testnet.arcscan.app/tx/${hash}`}>View transaction ↗</a>}
  <FormDialog open={modal === "settings"} onOpenChange={open=>{if(!open)setModal(null);}} busy={busy} title="Graduating-token market" description="V2 markets use ERC-20 quote assets and create a pool at graduation.">
   <form className="v2-form" onSubmit={e=>{e.preventDefault();void (async()=>{try{if(!isAddress(factoryInput))throw new Error("Enter a valid factory address.");await readV2Market(factoryInput);saveV2Factory(factoryInput);setSelected(undefined);setPage(0);setModal(null);}catch(e){setError(e instanceof Error?e.message:"Invalid market");}})();}}>
    <label>Factory address<input value={factoryInput} onChange={e=>setFactoryInput(e.target.value)} placeholder="0x…"/></label><button className="btn-secondary" disabled={busy}>Use V2 market</button>
   </form><p className="v2-note">Current market: {factory || "Not configured"}</p><button className="btn-primary" disabled={busy} onClick={()=>void run(deploy)}>Deploy V2 market</button>
   {error && <p role="alert">{error}</p>}
  </FormDialog>
  <FormDialog open={modal === "launch"} onOpenChange={open=>{if(!open)setModal(null);}} busy={busy} title="Launch graduating token" description="Fixed supply of 1,000,000. The final curve buy creates and seeds a locked pool.">
   <form className="v2-form" onSubmit={e=>{e.preventDefault();void run(launch);}}>
    <fieldset disabled={busy}>
     <label>Token name<input value={name} onChange={e=>setName(e.target.value)} maxLength={64} required/></label>
     <label>Token symbol<input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} maxLength={10} required/></label>
     <div className="v2-image-field"><span>Token artwork</span><div className="v2-image-picker">{tokenArtwork.map(name=>{const path=tokenImagePath(name);return <button type="button" key={name} aria-label={`Use ${name} artwork`} aria-pressed={image === path} onClick={()=>setImage(path)}><TokenImage src={path} name={`${name} artwork`} size={40}/></button>;})}</div></div>
     <label>Token image URL<input value={image} onChange={e=>setImage(e.target.value)} placeholder="https://… or ipfs://…" required/></label>
     {image && <TokenImage src={image} name={name || "Token preview"} size={80}/>}
     <label>Quote asset address<input value={quoteAsset} onChange={e=>setQuoteAsset(e.target.value)} required/></label>
     <label>Initial price per token<input value={startPrice} onChange={e=>setStartPrice(e.target.value)} inputMode="decimal" required/></label>
     <p className="v2-note">Default quote: Arc USDC ERC-20 (6 decimals). Standard launch, 1% trade fee. Buying the entire curve at the default price costs approximately 337 USDC plus gas.</p>
     <button className="btn-primary" type="submit" disabled={busy}>{address ? "Create graduating token" : "Connect wallet to launch"}</button>
    </fieldset>
   </form>{(message || error) && <p role="status">{error || message}</p>}
  </FormDialog>
 </section>;
}
