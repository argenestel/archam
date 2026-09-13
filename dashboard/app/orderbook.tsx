"use client";
import { OnchainTokenImage } from "./token-image";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  createWalletClient,
  custom,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash
} from "viem";
import { arcTestnet } from "viem/chains";
import {
  TrendingUp,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Check,
  X,
  Wallet,
  Settings2,
  Layers
} from "lucide-react";
import { curveToken } from "./generated/curveToken";
import { curveLaunchpad } from "./generated/curveLaunchpad";
import { coinPage } from "./curve-swap-safety";
import { orderBook } from "./generated/orderBook";
import { 
  arcClient, 
  bookConfigured, 
  money, 
  readTokens, 
  saveBook, 
  short, 
  unit, 
  useMarketAddresses 
} from "./market-data";
import { sameFillContext, type FillContext } from "./market-safety";
import "./orderbook.css";
import { FormDialog } from "./form-dialog";

type Order = {
  id: bigint;
  maker: Address;
  token: Address;
  isBuy: boolean;
  remaining: bigint;
  price: bigint;
  expiry: bigint;
};

const quantityOf = (text: string) =>
  /^\d{1,7}$/.test(text) && BigInt(text) > 0n && BigInt(text) <= 1_000_000n
    ? BigInt(text)
    : undefined;

function priceOf(text: string) {
  try {
    return /^\d{1,12}(\.\d{1,18})?$/.test(text) && parseUnits(text, 18) > 0n
      ? parseUnits(text, 18)
      : undefined;
  } catch {
    return undefined;
  }
}

export function OrderBook({
  onBusy,
  initialToken,
  initialTokenIndex,
  onLaunch,
}: {
  onBusy: (busy: boolean) => void;
  initialToken?: string;
  initialTokenIndex?: bigint;
  onLaunch?: () => void;
}) {
  const { factory, book } = useMarketAddresses();
  const { address, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const cache = useQueryClient();
  const lock = useRef(false);

  const [busy, setBusy] = useState(false);
  const [tokenAddress, setTokenAddress] = useState(initialToken ?? "");
  const [requestedPage, setTokenPage] = useState<number>();
  const [page, setPage] = useState(0);
  const [isBuy, setIsBuy] = useState(true);
  const [quantity, setQuantity] = useState("100");
  const [price, setPrice] = useState("0.001");
  const [duration, setDuration] = useState("24");
  const [fill, setFill] = useState<
    Order & { context: FillContext; symbol: string; name: string }
  >();
  const [fillQuantity, setFillQuantity] = useState("");
  const [bookInput, setBookInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [ticketOpen, setTicketOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const tokens = useQuery({
    queryKey: ["curve-book-tokens", factory, requestedPage, initialTokenIndex?.toString()],
    enabled: isAddress(factory),
    queryFn: async () => {
      if (!isAddress(factory)) throw new Error("Select a launch market.");
      const count = await arcClient.readContract({ address: factory, abi: curveLaunchpad.abi, functionName: "tokenCount" });
      const initialPage = coinPage(count, initialTokenIndex);
      const resolvedPage = requestedPage ?? initialPage;
      return { ...await readTokens(factory, resolvedPage), resolvedPage };
    },
    refetchInterval: 20000,
  });

  const tokenPage = tokens.data?.resolvedPage ?? 0;
  const token = tokens.data?.tokens.find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );

  const fillValid =
    !!fill &&
    !tokens.isError &&
    sameFillContext(fill.context, {
      factory,
      book,
      token: token?.address ?? "",
      account: address ?? "",
    });

  const state = useQuery({
    queryKey: ["orderbook", book, factory, page, address],
    enabled: isAddress(book) && isAddress(factory),
    refetchInterval: 12000,
    queryFn: async () => {
      const base = { address: book as Address, abi: orderBook.abi } as const;
      const linked = await arcClient.readContract({ ...base, functionName: "factory" });
      if (linked.toLowerCase() !== factory.toLowerCase()) {
        throw new Error(
          "This orderbook belongs to a different launch market. Choose its matching orderbook below."
        );
      }
      const count = await arcClient.readContract({ ...base, functionName: "orderCount" });
      const end = count - BigInt(page * 40);
      const length = Number(end > 40n ? 40n : end > 0n ? end : 0n);
      const [orders, block, credits] = await Promise.all([
        Promise.all(
          Array.from({ length }, async (_, i): Promise<Order> => {
            const id = end - 1n - BigInt(i);
            const [maker, tAddr, isB, rem, prc, exp] = await arcClient.readContract({
              ...base,
              functionName: "orders",
              args: [id],
            });
            return { id, maker, token: tAddr, isBuy: isB, remaining: rem, price: prc, expiry: exp };
          })
        ),
        arcClient.getBlock(),
        address
          ? arcClient.readContract({ ...base, functionName: "credits", args: [address] })
          : Promise.resolve(0n),
      ]);
      return { orders, count, timestamp: block.timestamp, credits };
    },
  });

  const ready = !!state.data && !state.isError;

  async function walletContext() {
    if (!address || !connector) throw new Error("Connect your wallet to continue.");
    await switchChainAsync({ chainId: arcTestnet.id });
    const wallet = createWalletClient({
      account: address,
      chain: arcTestnet,
      transport: custom((await connector.getProvider()) as EIP1193Provider),
    });
    if (
      (await wallet.getAddresses())[0]?.toLowerCase() !== address.toLowerCase() ||
      (await wallet.getChainId()) !== arcTestnet.id
    ) {
      throw new Error("Your wallet changed. Reconnect on Arc Testnet and retry.");
    }
    const fees = await arcClient.estimateFeesPerGas();
    return {
      wallet,
      fees: {
        maxFeePerGas:
          fees.maxFeePerGas > parseUnits("20", 9) ? fees.maxFeePerGas : parseUnits("20", 9),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      },
    };
  }

  async function confirm(tx: Hash) {
    setHash(tx);
    setMessage("Transaction submitted. Waiting for Arc confirmation…");
    let replacementError: string | undefined;
    const receipt = await arcClient.waitForTransactionReceipt({
      hash: tx,
      onReplaced: ({ reason, transactionReceipt }) => {
        setHash(transactionReceipt.transactionHash);
        if (reason !== "repriced") {
          replacementError = `Transaction ${reason}. The requested action was not confirmed.`;
        }
      },
    });
    setHash(receipt.transactionHash);
    if (replacementError) throw new Error(replacementError);
    if (receipt.status !== "success") {
      throw new Error("Transaction reverted. No order change was applied.");
    }
    await cache.invalidateQueries({
      predicate: q => /^(orderbook|curve-|portfolio)/.test(String(q.queryKey[0])),
    });
    return receipt;
  }

  async function run(action: () => Promise<void>) {
    if (!address) {
      openConnectModal?.();
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setHash(undefined);
    setMessage("Review the request in your wallet…");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete this request.");
      setMessage("Request not completed. Check any submitted transaction before retrying.");
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  async function verifyBook() {
    if (!isAddress(book) || !isAddress(factory)) {
      throw new Error("Set up the market and orderbook first.");
    }
    const linked = await arcClient.readContract({
      address: book,
      abi: orderBook.abi,
      functionName: "factory",
    });
    if (linked.toLowerCase() !== factory.toLowerCase()) {
      throw new Error("Orderbook and launch market do not match.");
    }
    return book;
  }

  async function deploy() {
    if (!isAddress(factory)) throw new Error("Create or join a market in Launch first.");
    const { wallet, fees } = await walletContext();
    const receipt = await confirm(
      await wallet.deployContract({ ...orderBook, args: [factory], ...fees })
    );
    if (!receipt.contractAddress) throw new Error("Deployment address was unavailable.");
    saveBook(receipt.contractAddress);
    setMessage("Your orderbook is ready. Share its address to trade together.");
  }

  async function approve(
    tokenAddr: Address,
    amountBig: bigint,
    ctx: Awaited<ReturnType<typeof walletContext>>,
    target: Address
  ) {
    setMessage("Approve the tokens required for this trade in your wallet.");
    const { request } = await arcClient.simulateContract({
      address: tokenAddr,
      abi: curveToken.abi,
      functionName: "approve",
      args: [target, amountBig * unit],
      account: address!,
      ...ctx.fees,
    });
    await confirm(await ctx.wallet.writeContract(request));
    if (
      (await ctx.wallet.getAddresses())[0]?.toLowerCase() !== address?.toLowerCase() ||
      (await ctx.wallet.getChainId()) !== arcTestnet.id
    ) {
      throw new Error("Wallet changed after approval. Reconnect before trading.");
    }
    setMessage("Approval confirmed. Confirm your order in your wallet.");
  }

  async function post() {
    const amountBig = quantityOf(quantity);
    const valueBig = priceOf(price);
    if (!token || tokens.isError || !amountBig || !valueBig) {
      throw new Error(
        "Choose a token, enter 1–1,000,000 whole tokens and a positive USDC price (up to 18 decimals)."
      );
    }
    const target = await verifyBook();
    const ctx = await walletContext();
    if (!isBuy) await approve(token.address, amountBig, ctx, target);
    const block = await arcClient.getBlock();
    const { request } = await arcClient.simulateContract({
      address: target,
      abi: orderBook.abi,
      functionName: "postOrder",
      args: [
        token.index,
        isBuy,
        amountBig,
        valueBig,
        block.timestamp + BigInt(duration) * 3600n,
      ],
      value: isBuy ? amountBig * valueBig : 0n,
      account: address!,
      ...ctx.fees,
    });
    await confirm(await ctx.wallet.writeContract(request));
    setPage(0);
    setMessage("Limit order placed onchain. Anyone can fill it before expiration.");
  }

  async function take() {
    const amountBig = quantityOf(fillQuantity);
    if (!fillValid || !fill || !amountBig || amountBig > fill.remaining) {
      throw new Error("Enter a whole-token amount within this order's remaining quantity.");
    }
    const target = await verifyBook();
    const ctx = await walletContext();
    const current = await arcClient.readContract({
      address: target,
      abi: orderBook.abi,
      functionName: "orders",
      args: [fill.id],
    });
    if (
      current[0].toLowerCase() !== fill.maker.toLowerCase() ||
      current[1].toLowerCase() !== fill.token.toLowerCase() ||
      current[2] !== fill.isBuy ||
      current[4] !== fill.price ||
      current[5] !== fill.expiry ||
      current[3] < amountBig ||
      current[5] <= (await arcClient.getBlock()).timestamp
    ) {
      throw new Error("This order changed or expired. Refresh and choose another order.");
    }
    if (fill.isBuy) await approve(fill.token, amountBig, ctx, target);
    const { request } = await arcClient.simulateContract({
      address: target,
      abi: orderBook.abi,
      functionName: "fillOrder",
      args: [fill.id, amountBig],
      value: fill.isBuy ? 0n : amountBig * fill.price,
      account: address!,
      ...ctx.fees,
    });
    await confirm(await ctx.wallet.writeContract(request));
    setFill(undefined);
    setMessage(
      fill.isBuy
        ? "Tokens sold! Withdraw your USDC proceeds below."
        : "Trade executed! Tokens transferred to your wallet."
    );
  }

  async function cancel(id: bigint) {
    const target = await verifyBook();
    const { wallet, fees } = await walletContext();
    const { request } = await arcClient.simulateContract({
      address: target,
      abi: orderBook.abi,
      functionName: "cancelOrder",
      args: [id],
      account: address!,
      ...fees,
    });
    await confirm(await wallet.writeContract(request));
    setMessage(
      "Order cancelled. Returned USDC is ready to withdraw; sell tokens returned to wallet."
    );
  }

  async function withdraw() {
    const target = await verifyBook();
    const { wallet, fees } = await walletContext();
    const { request } = await arcClient.simulateContract({
      address: target,
      abi: orderBook.abi,
      functionName: "withdraw",
      account: address!,
      ...fees,
    });
    await confirm(await wallet.writeContract(request));
    setMessage("USDC credits withdrawn to your wallet.");
  }

  const visible = (state.data?.orders ?? []).filter(
    o =>
      o.token.toLowerCase() === token?.address.toLowerCase() &&
      o.remaining > 0n &&
      o.expiry > (state.data?.timestamp ?? 0n)
  );

  const bids = visible
    .filter(o => o.isBuy)
    .sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0));
  const asks = visible
    .filter(o => !o.isBuy)
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));

  const maxBidQty = bids.reduce((max, o) => (o.remaining > max ? o.remaining : max), 1n);
  const maxAskQty = asks.reduce((max, o) => (o.remaining > max ? o.remaining : max), 1n);

  const own = (state.data?.orders ?? []).filter(
    o => o.maker.toLowerCase() === address?.toLowerCase() && o.remaining > 0n
  );

  const amountBig = quantityOf(quantity);
  const valueBig = priceOf(price);

  function renderDepthRows(orders: Order[], buy: boolean, maxQty: bigint) {
    return (
      <div className="ob-depth">
        <div className="ob-table-head">
          <span>Price (USDC)</span>
          <span className="text-right">Tokens</span>
          <span className="text-right">Action</span>
        </div>
        {orders.length ? (
          orders.map(o => {
            const isMine = o.maker.toLowerCase() === address?.toLowerCase();
            const barWidth = Math.min(100, Math.max(8, Number((o.remaining * 100n) / maxQty)));
            return (
              <div
                className="ob-row"
                key={o.id.toString()}
                onClick={() => {
                  // autofill price on click
                  setPrice(formatUnits(o.price, 18));
                }}
              >
                <div
                  className={`ob-depth-bar ${buy ? "bid" : "ask"}`}
                  style={{ width: `${barWidth}%` }}
                />
                <span className={buy ? "ob-bid" : "ob-ask"}>{money(o.price)}</span>
                <span className="text-right text-chalk font-mono">
                  {o.remaining.toLocaleString()}
                </span>
                <div className="text-right" onClick={e => e.stopPropagation()}>
                  <button
                    disabled={busy || tokens.isError || isMine}
                    onClick={() => {
                      if (!address) {
                        openConnectModal?.();
                        return;
                      }
                      if (!token) return;
                      setTicketOpen(true);
                      setFill({
                        ...o,
                        context: {
                          factory,
                          book,
                          token: o.token,
                          account: address ?? "",
                        },
                        symbol: token.symbol,
                        name: token.name,
                      });
                      setFillQuantity(o.remaining.toString());
                    }}
                  >
                    {isMine ? "Yours" : buy ? "Sell into Bid" : "Buy Ask"}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="ob-empty">
            <span>No {buy ? "bids" : "asks"} on this page.</span>
            <button
              className="text-xs text-spring hover:text-spring font-semibold mt-1"
              onClick={() => { setIsBuy(buy); setTicketOpen(true); }}
            >
              Post the first {buy ? "bid" : "ask"} →
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="ob-section">
      {/* Page Header */}
      <div className="ob-heading">
        <div>
          <h1>Trade on Arc</h1>
          <p>
            Post or fill fully escrowed limit orders.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={() => setTicketOpen(true)}>Place order</button>
          <button
            className="btn-secondary text-xs py-2 px-3 flex items-center gap-2"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 size={14} />
            <span>Book Config</span>
          </button>
          <span className="ob-network">
            <i /> Arc Testnet
          </span>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <FormDialog open={showSettings} onOpenChange={setShowSettings} busy={busy} title="Orderbook settings" description="Configure the public market orderbook.">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-chalk flex items-center gap-2">
              <Settings2 size={15} className="text-spring" />
              <span>OrderBook Addresses</span>
            </h3>
            <button
              className="text-stone hover:text-chalk"
              onClick={() => setShowSettings(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="text-xs text-chalk space-y-1 mb-4">
            <p>
              Launch Market Factory: {isAddress(factory) ? short(factory) : "Not set"}
            </p>
            <p>
              OrderBook Contract:{" "}
              {isAddress(book) ? (
                <a
                  href={`https://testnet.arcscan.app/address/${book}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-spring underline font-mono"
                >
                  {short(book)} ↗
                </a>
              ) : (
                <span className="text-warn">Not deployed</span>
              )}
            </p>
          </div>
          {!bookConfigured && (
            <form
              className="flex flex-col sm:flex-row gap-3 max-w-xl"
              onSubmit={async e => {
                e.preventDefault();
                if (!isAddress(bookInput)) {
                  setError("Enter a valid orderbook address.");
                  return;
                }
                try {
                  const linked = await arcClient.readContract({
                    address: bookInput,
                    abi: orderBook.abi,
                    functionName: "factory",
                  });
                  if (linked.toLowerCase() !== factory.toLowerCase()) {
                    throw new Error("This orderbook belongs to a different market.");
                  }
                  saveBook(bookInput);
                  setPage(0);
                  setFill(undefined);
                  setError("");
                  setShowSettings(false);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not read this orderbook.");
                }
              }}
            >
              <input
                placeholder="Join existing orderbook address 0x..."
                value={bookInput}
                onChange={e => setBookInput(e.target.value)}
                className="text-xs"
              />
              <button className="btn-secondary whitespace-nowrap text-xs">
                Switch Book
              </button>
            </form>
          )}
        </FormDialog>
      )}

      {/* Setup Step if no factory or no orderbook */}
      {!isAddress(factory) ? (
        <div className="ob-card ob-setup">
          <h2>Select a Market First</h2>
          <p>
            Create or join a launch market on Arc. Its coins will be available here for limit order trading.
          </p>
          {onLaunch && (
            <button className="btn-primary" onClick={onLaunch}>
              <TrendingUp size={15} />
              <span>Explore the Launchpad →</span>
            </button>
          )}
        </div>
      ) : !isAddress(book) ? (
        <div className="ob-card ob-setup">
          <h2>Deploy OrderBook for Market</h2>
          <p>
            Deploy the escrow limit orderbook contract once for this launch market. Your wallet pays standard Arc deployment gas.
          </p>
          <button
            className="btn-primary"
            disabled={busy || !!bookConfigured}
            onClick={() => void run(deploy)}
          >
            {busy ? "Deploying OrderBook…" : "Deploy OrderBook Contract"}
          </button>
        </div>
      ) : null}

      {/* Terminal Main Box */}
      <div className="ob-terminal">
        {/* Market Bar */}
        <div className="ob-market-bar">
          <div className="ob-market-select-wrap">
            <label className="text-[10px] font-semibold text-stone mb-1 block">
              Trading Pair
            </label>
            <select
              disabled={busy || !tokens.data?.tokens.length}
              value={token?.address ?? ""}
              onChange={e => {
                setTokenAddress(e.target.value);
                setFill(undefined);
              }}
            >
              <option value="">
                {tokens.isError
                  ? "Market unavailable"
                  : tokens.data?.tokens.length
                  ? "Select a coin pair…"
                  : "No coins found"}
              </option>
              {tokens.data?.tokens.map(t => (
                <option value={t.address} key={t.address}>
                  {t.symbol} / USDC
                </option>
              ))}
            </select>
          </div>

          {token && (
            <div className="flex items-center gap-3">
              <span className="text-xl p-2 rounded-xl bg-spring/15 border border-line">
                <OnchainTokenImage address={token.address} size={28} />
              </span>
              <div>
                <b className="text-chalk text-sm block">{token.name}</b>
                <span className="text-xs text-stone font-mono">
                  {short(token.address)}
                </span>
              </div>
            </div>
          )}

          <div className="ob-market-note">
            <b>100% Escrow Settlement</b>
            <span>Zero platform fees · Fully sovereign onchain order execution</span>
          </div>

          <button
            className="ob-refresh-btn"
            disabled={busy || state.isFetching || !isAddress(book)}
            onClick={() => void state.refetch()}
            title="Refresh orderbook"
          >
            <RefreshCw size={13} className={state.isFetching ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Token List Pager if multiple pages */}
        {tokens.data && tokens.data.count > 20n && (
          <div className="ob-pager">
            <button
              disabled={busy || tokenPage === 0}
              onClick={() => {
                setTokenPage(tokenPage - 1);
                setFill(undefined);
              }}
            >
              ← Newer pairs
            </button>
            <span>Coin page {tokenPage + 1}</span>
            <button
              disabled={busy || BigInt((tokenPage + 1) * 20) >= tokens.data.count}
              onClick={() => {
                setTokenPage(tokenPage + 1);
                setFill(undefined);
              }}
            >
              Older pairs →
            </button>
          </div>
        )}

        {/* Terminal Grid: Left (Orderbook Depth) + Right (Trade Ticket) */}
        <div className="ob-grid">
          {/* Orderbook Depth View */}
          <div className="ob-book">
            <div className="ob-card-title">
              <h2>
                <Layers size={18} className="text-spring" />
                <span>Market Depth</span>
              </h2>
              <span className="font-mono">
                {state.isFetching ? "Syncing Arc..." : ready ? "Live onchain" : "Connecting..."}
              </span>
            </div>

            <div className="ob-sides">
              <div className="ob-side-col">
                <div className="ob-side-heading bid">
                  <span>Bids (Buy Orders)</span>
                  <small>{bids.length} orders</small>
                </div>
                {renderDepthRows(bids, true, maxBidQty)}
              </div>

              <div className="ob-side-col">
                <div className="ob-side-heading ask">
                  <span>Asks (Sell Orders)</span>
                  <small>{asks.length} orders</small>
                </div>
                {renderDepthRows(asks, false, maxAskQty)}
              </div>
            </div>

            <p className="ob-caption">
              Displaying orders on this page for {token ? `${token.symbol}/USDC` : "this pair"}. Orders fill directly without automatic matching. Click any order row to match or populate price.
            </p>

            {state.data && state.data.count > 40n && (
              <div className="ob-pager mt-4">
                <button disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>
                  ← Newer
                </button>
                <span>Order page {page + 1}</span>
                <button
                  disabled={BigInt((page + 1) * 40) >= state.data.count || busy}
                  onClick={() => setPage(page + 1)}
                >
                  Older →
                </button>
              </div>
            )}
          </div>

          <FormDialog open={ticketOpen} onOpenChange={open => { setTicketOpen(open); if (!open) setFill(undefined); }} busy={busy} title={fill ? "Fill order" : "Place limit order"} description="Review amounts and confirm in your wallet.">
          <form
            className="ob-ticket"
            onSubmit={e => {
              e.preventDefault();
              void run(fill ? take : post);
            }}
          >
            <div className="ob-card-title">
              <h2>
                {fill ? (
                  <span>Fill Order #{fill.id.toString()}</span>
                ) : (
                  <span>Place Limit Order</span>
                )}
              </h2>
              {fill && (
                <button
                  type="button"
                  className="p-1 rounded bg-surface text-stone hover:text-chalk"
                  onClick={() => setFill(undefined)}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {fill && !fillValid && (
              <div className="p-3 mb-4 rounded-xl bg-ember/10 border border-ember/30 text-ember text-xs">
                Order context changed. Please close this ticket and select the order again.
              </div>
            )}

            <fieldset disabled={busy || !ready || !token || tokens.isError || (!!fill && !fillValid)}>
              {fill ? (
                /* Fill Existing Order UI */
                <div className="space-y-4">
                  <div className="ob-fill-summary p-3.5 rounded-xl bg-night border border-line space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-stone">Order Action:</span>
                      <b className={fill.isBuy ? "text-spring" : "text-ember"}>
                        {fill.isBuy ? "Sell into Bid" : "Buy Ask"}
                      </b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone">Fixed Price:</span>
                      <b className="text-chalk font-mono">{money(fill.price)} USDC</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone">Maker:</span>
                      <span className="font-mono text-chalk">{short(fill.maker)}</span>
                    </div>
                  </div>

                  <label>
                    <div className="ob-field-header">
                      <span>Tokens to {fill.isBuy ? "Sell" : "Buy"}</span>
                      <span>Max: {fill.remaining.toLocaleString()}</span>
                    </div>
                    <input
                      inputMode="numeric"
                      value={fillQuantity}
                      onChange={e => setFillQuantity(e.target.value)}
                      required
                    />
                  </label>

                  <div className="ob-total-card">
                    <span>Total Settlement (USDC)</span>
                    <strong className="font-mono">
                      {quantityOf(fillQuantity)
                        ? money(quantityOf(fillQuantity)! * fill.price)
                        : "—"}
                    </strong>
                  </div>

                  <button className="btn-primary w-full py-3" type="submit">
                    {busy ? "Confirming Fill…" : "Execute Fill Order"}
                  </button>
                </div>
              ) : (
                /* Place New Limit Order UI */
                <div className="space-y-4">
                  {/* Buy / Sell Toggle */}
                  <div className="ob-toggle">
                    <button
                      type="button"
                      className={isBuy ? "active" : ""}
                      onClick={() => setIsBuy(true)}
                    >
                      Buy {token?.symbol ?? ""}
                    </button>
                    <button
                      type="button"
                      className={!isBuy ? "active ob-sell" : ""}
                      onClick={() => setIsBuy(false)}
                    >
                      Sell {token?.symbol ?? ""}
                    </button>
                  </div>

                  {/* Limit Price */}
                  <label>
                    <div className="ob-field-header">
                      <span>Limit Price</span>
                      <span>USDC per token</span>
                    </div>
                    <input
                      inputMode="decimal"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder="0.001"
                      required
                    />
                  </label>

                  {/* Quantity */}
                  <label>
                    <div className="ob-field-header">
                      <span>Quantity</span>
                      <span>Whole Tokens</span>
                    </div>
                    <input
                      inputMode="numeric"
                      value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                      placeholder="100"
                      required
                    />
                  </label>

                  {/* Preset increments */}
                  <div className="grid grid-cols-4 gap-2">
                    {[100, 500, 1000, 5000].map(n => (
                      <button
                        type="button"
                        key={n}
                        className="py-1 px-2 rounded-lg bg-night border border-line hover:border-spring/40 text-xs font-semibold text-chalk text-center"
                        onClick={() => setQuantity(String(n))}
                      >
                        +{n}
                      </button>
                    ))}
                  </div>

                  {/* Expiration */}
                  <label>
                    <div className="ob-field-header">
                      <span>Order Expiry</span>
                      <span>Duration</span>
                    </div>
                    <select value={duration} onChange={e => setDuration(e.target.value)}>
                      <option value="1">1 hour</option>
                      <option value="24">24 hours</option>
                      <option value="168">7 days</option>
                      <option value="720">30 days</option>
                    </select>
                  </label>

                  {/* Order Total / Escrow */}
                  <div className="ob-total-card">
                    <span>{isBuy ? "USDC to Escrow" : "Order Valuation"}</span>
                    <strong className="font-mono">
                      {amountBig && valueBig ? `${money(amountBig * valueBig)} USDC` : "—"}
                    </strong>
                  </div>

                  <button
                    className={`w-full py-3 ${isBuy ? "btn-emerald" : "btn-rose"}`}
                    type="submit"
                  >
                    {busy
                      ? "Confirming Onchain…"
                      : !address
                      ? "Connect Wallet"
                      : `Place Limit ${isBuy ? "Buy" : "Sell"} Order`}
                  </button>

                  <p className="ob-caption text-center">
                    {isBuy
                      ? "USDC is deposited into the escrow contract until filled or cancelled."
                      : "Tokens are approved and escrowed into the orderbook."}
                  </p>
                </div>
              )}
            </fieldset>
          </form>
          </FormDialog>
        </div>
      </div>

      {/* Your Open Orders & Settlement Vault */}
      <div className="ob-account">
        {/* Open Orders Table (8 cols) */}
        <div className="ob-card">
          <div className="ob-card-title">
            <h2>
              <span>Your Active Orders</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-spring/15 text-spring font-mono">
                {own.length}
              </span>
            </h2>
          </div>

          {!address ? (
            <p className="text-xs text-stone py-6 text-center">
              Connect your wallet to see your open limit orders.
            </p>
          ) : own.length === 0 ? (
            <div className="py-8 text-center text-xs text-stone">
              No active orders on this page.
            </div>
          ) : (
            <div className="ob-orders-table-wrap">
              <table className="ob-orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Pair</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {own.map(o => {
                    const pairToken = tokens.data?.tokens.find(t => t.address === o.token);
                    const isExpired = o.expiry <= (state.data?.timestamp ?? 0n);
                    return (
                      <tr key={o.id.toString()}>
                        <td>
                          <b className={o.isBuy ? "text-spring" : "text-ember"}>
                            #{o.id.toString()} {o.isBuy ? "BUY" : "SELL"}
                          </b>
                        </td>
                        <td>{pairToken?.symbol ?? short(o.token)}</td>
                        <td className="font-mono">{o.remaining.toLocaleString()}</td>
                        <td className="font-mono">{money(o.price)} USDC</td>
                        <td>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              isExpired
                                ? "bg-warn/15 text-warn"
                                : "bg-spring/15 text-spring"
                            }`}
                          >
                            {isExpired ? "Expired" : "Active"}
                          </span>
                        </td>
                        <td className="text-right">
                          <button
                            className="ob-cancel-btn"
                            disabled={busy}
                            onClick={() => void run(() => cancel(o.id))}
                          >
                            Cancel & Recover
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Settlement Vault Card (4 cols) */}
        <div className="ob-card flex flex-col justify-between">
          <div>
            <div className="ob-card-title">
              <h2>
                <Wallet size={16} className="text-spring" />
                <span>Settlement Vault</span>
              </h2>
            </div>
            <p className="text-xs text-chalk leading-relaxed mb-4">
              Proceeds from filled sell orders and returned escrow from cancelled buy orders are credited here.
            </p>
          </div>

          <div className="ob-credit-box">
            <span className="text-[11px] font-semibold text-stone block mb-1">
              Withdrawable Balance
            </span>
            <div className="text-2xl font-bold text-chalk font-mono">
              {ready ? `${money(state.data!.credits)}` : "—"}{" "}
              <span className="text-sm font-semibold text-spring">USDC</span>
            </div>
          </div>

          <button
            className="btn-emerald w-full py-3"
            disabled={busy || !ready || !state.data?.credits}
            onClick={() => void run(withdraw)}
          >
            <Wallet size={15} />
            <span>Withdraw USDC to Wallet</span>
          </button>
        </div>
      </div>

      {/* Transaction Notifications */}
      {(message || error) && (
        <div className={`status-toast ${error ? "error" : ""}`} role="status">
          <div className="flex items-start gap-2">
            <div className="mt-0.5">
              {error ? <AlertCircle size={16} /> : <Check size={16} className="text-spring" />}
            </div>
            <div className="flex-1">
              <p className="font-semibold">{message}</p>
              {error && <p className="text-xs mt-1 text-ember">{error}</p>}
              {hash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs mt-2 text-spring underline"
                >
                  <span>View transaction on ArcScan</span>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
