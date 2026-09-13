"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { 
  createPublicClient, 
  createWalletClient, 
  custom, 
  decodeEventLog, 
  formatUnits, 
  http, 
  isAddress, 
  parseUnits, 
  type Address, 
  type EIP1193Provider, 
  type Hash 
} from "viem";
import { arcTestnet } from "viem/chains";
import { 
  Rocket, 
  Search, 
  RefreshCw, 
  Sparkles, 
  ExternalLink, 
  Check, 
  X, 
  Coins, 
  TrendingUp, 
  AlertCircle, 
  Settings2,
} from "lucide-react";
import { curveLaunchpad } from "./generated/curveLaunchpad";
import { Button } from "@radix-ui/themes";
import { FormDialog } from "./form-dialog";
import type { MarketToken } from "./market-data";
import { curveToken } from "./generated/curveToken";
import { TokenImage, tokenArtwork, tokenImagePath, tokenImageInputError } from "./token-image";

const client = createPublicClient({ chain: arcTestnet, transport: http() });
const configured = process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS ?? "";

const curatedIcons = tokenArtwork.map(tokenImagePath);

const storageKey = "mofu-curve-market-v1";
const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  window.addEventListener("mofu-market", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("mofu-market", fn);
  };
};
const snapshot = () => {
  try {
    return configured || localStorage.getItem(storageKey) || "";
  } catch {
    return configured;
  }
};

const compact = (amount: bigint, decimals = 18) =>
  Number(formatUnits(amount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });

type Token = {
  index?: bigint;
  address: Address;
  name: string;
  symbol: string;
  description: string;
  icon: string;
  creator: Address;
  supply: bigint;
  reserve: bigint;
};

export function Launchpad({ onBusy, onTradePair, onSwap }: { onBusy: (busy: boolean) => void; onTradePair?: (token: MarketToken) => void; onSwap?: (token: MarketToken) => void }) {
  const factory = useSyncExternalStore(subscribe, snapshot, () => configured);
  const validFactory = isAddress(factory);
  const { address, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(curatedIcons[0]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Token>();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [showSettings, setShowSettings] = useState(false);
  const [marketInput, setMarketInput] = useState("");

  const market = useQuery({
    queryKey: ["curve-market", factory, page],
    enabled: validFactory,
    refetchInterval: 15000,
    queryFn: async () => {
      if (!isAddress(factory)) throw new Error("Invalid market address.");
      const count = await client.readContract({
        address: factory,
        abi: curveLaunchpad.abi,
        functionName: "tokenCount",
      });
      const end = count - BigInt(page * 12);
      const length = Number(end > 12n ? 12n : end > 0n ? end : 0n);
      const tokens = await Promise.all(
        Array.from({ length }, async (_, i): Promise<Token> => {
          const tokenAddress = await client.readContract({
            address: factory,
            abi: curveLaunchpad.abi,
            functionName: "tokens",
            args: [end - 1n - BigInt(i)],
          });
          const base = { address: tokenAddress, abi: curveToken.abi } as const;
          const [tName, tSymbol, tDesc, tIcon, creator, supply] = await client.multicall({
            allowFailure: false,
            contracts: [
              { ...base, functionName: "name" },
              { ...base, functionName: "symbol" },
              { ...base, functionName: "description" },
              { ...base, functionName: "icon" },
              { ...base, functionName: "creator" },
              { ...base, functionName: "totalSupply" },
            ],
          });
          const whole = supply / 10n ** 18n;
          const reserve = await client.readContract({
            ...base,
            functionName: "reserveAt",
            args: [whole],
          });
          return {
            index: end - 1n - BigInt(i),
            address: tokenAddress,
            name: tName,
            symbol: tSymbol,
            description: tDesc,
            icon: tIcon,
            creator,
            supply: whole,
            reserve,
          };
        })
      );
      return { count, tokens };
    },
  });

  const active = market.data?.tokens.find(t => t.address === selected?.address) ?? selected;
  const quantity =
    /^\d{1,7}$/.test(amount) && BigInt(amount) > 0n && BigInt(amount) <= 1_000_000n
      ? BigInt(amount)
      : undefined;

  const quote = useQuery({
    queryKey: ["curve-quote", active?.address, side, amount, address],
    enabled: !!active && quantity !== undefined,
    refetchInterval: 10000,
    retry: false,
    queryFn: async () => {
      if (!active || quantity === undefined) throw new Error("Enter 1–1,000,000 whole tokens.");
      const value = await client.readContract({
        address: active.address,
        abi: curveToken.abi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [quantity],
      });
      // eslint-disable-next-line react-hooks/purity -- runs inside the query fetcher, not render
      return { value, at: Date.now() };
    },
  });

  const holding = useQuery({
    queryKey: ["curve-holding", active?.address, address],
    enabled: !!active && !!address,
    refetchInterval: 10000,
    queryFn: () =>
      client.readContract({
        address: active!.address,
        abi: curveToken.abi,
        functionName: "balanceOf",
        args: [address!],
      }),
  });

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
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
      setMessage("Not completed. If a transaction was submitted, check it before retrying.");
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  async function walletContext() {
    if (!address || !connector) throw new Error("Connect your wallet.");
    setMessage("Confirm on Arc Testnet in your wallet…");
    await switchChainAsync({ chainId: arcTestnet.id });
    const provider = (await connector.getProvider()) as EIP1193Provider;
    const wallet = createWalletClient({
      account: address,
      chain: arcTestnet,
      transport: custom(provider),
    });
    const accounts = await wallet.getAddresses();
    if (accounts[0]?.toLowerCase() !== address.toLowerCase()) {
      throw new Error("Wallet changed. Reconnect and try again.");
    }
    const fees = await client.estimateFeesPerGas();
    return {
      wallet,
      fees: {
        maxFeePerGas:
          fees.maxFeePerGas > parseUnits("20", 9) ? fees.maxFeePerGas : parseUnits("20", 9),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      },
    };
  }

  async function receipt(transaction: Hash) {
    setHash(transaction);
    setMessage("Submitted. Waiting for Arc confirmation…");
    let replacedAction = false;
    const result = await client.waitForTransactionReceipt({
      hash: transaction,
      onReplaced: replacement => {
        setHash(replacement.transactionReceipt.transactionHash);
        if (replacement.reason !== "repriced") replacedAction = true;
      },
    });
    setHash(result.transactionHash);
    if (replacedAction) {
      throw new Error(
        "Transaction was cancelled or replaced in your wallet. The requested action was not confirmed."
      );
    }
    if (result.status !== "success") throw new Error("Transaction reverted onchain.");
    await queryClient.invalidateQueries({
      predicate: q => /^(curve-|portfolio-|orderbook)/.test(String(q.queryKey[0])),
    });
    return result;
  }

  async function setupMarket() {
    const { wallet, fees } = await walletContext();
    const result = await receipt(await wallet.deployContract({ ...curveLaunchpad, ...fees }));
    if (!result.contractAddress) throw new Error("No market address returned.");
    localStorage.setItem(storageKey, result.contractAddress);
    window.dispatchEvent(new Event("mofu-market"));
    setMessage(`Market deployed at ${result.contractAddress}. Share this address so others can trade together.`);
  }

  async function create() {
    if (!validFactory) throw new Error("Set up a market first.");
    const imageError = tokenImageInputError(icon);
    if (imageError) throw new Error(imageError);
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 64) {
      throw new Error("Name must be 1–64 bytes.");
    }
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) {
      throw new Error("Use 1–10 letters or numbers for the ticker.");
    }
    if (new TextEncoder().encode(description).length > 280) {
      throw new Error("Description must be at most 280 UTF-8 bytes.");
    }
    const { wallet, fees } = await walletContext();
    const result = await receipt(
      await wallet.writeContract({
        address: factory as Address,
        abi: curveLaunchpad.abi,
        functionName: "createToken",
        args: [name.trim(), symbol, description, icon.trim()],
        ...fees,
      })
    );
    const event = result.logs
      .filter(log => log.address.toLowerCase() === factory.toLowerCase())
      .map(log => {
        try {
          return decodeEventLog({
            abi: curveLaunchpad.abi,
            data: log.data,
            topics: log.topics,
          });
        } catch {
          return undefined;
        }
      })
      .find(log => log?.eventName === "TokenCreated");

    if (event?.eventName === "TokenCreated") {
      setSelected({
        address: event.args.token,
        creator: address!,
        name: name.trim(),
        symbol,
        description,
        icon,
        supply: 0n,
        reserve: 0n,
      });
    }
    setPage(0);
    setCreating(false);
    setMessage(`${symbol} is live on Arc. No premint — anyone can buy on the curve immediately.`);
    setName("");
    setSymbol("");
    setDescription("");
  }

  async function trade() {
    if (
      !active ||
      !quantity ||
      !quote.data ||
      quote.isError ||
      // eslint-disable-next-line react-hooks/purity -- event-handler context
      Date.now() - quote.data.at > 30000
    ) {
      throw new Error("Wait for a fresh quote, then try again.");
    }
    if (
      side === "sell" &&
      (holding.data === undefined || holding.data < quantity * 10n ** 18n)
    ) {
      throw new Error("Not enough tokens in your wallet.");
    }
    const value = quote.data.value;
    const limit = side === "buy" ? (value * 101n + 99n) / 100n : (value * 99n) / 100n;
    const { wallet, fees } = await walletContext();
    const block = await client.getBlock();
    const args = [quantity, limit, block.timestamp + 120n] as const;
    const params = {
      address: active.address,
      abi: curveToken.abi,
      account: address!,
      ...fees,
    } as const;

    if (side === "buy") {
      const { request } = await client.simulateContract({
        ...params,
        functionName: "buy",
        args,
        value: limit,
      });
      await receipt(await wallet.writeContract(request));
    } else {
      const { request } = await client.simulateContract({
        ...params,
        functionName: "sell",
        args,
      });
      await receipt(await wallet.writeContract(request));
    }
    setMessage(`${side === "buy" ? "Bought" : "Sold"} ${quantity.toLocaleString()} ${active.symbol}.`);
  }

  const tokens = (market.data?.tokens ?? []).filter(t =>
    `${t.name} ${t.symbol} ${t.address}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="py-2">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
        <div>
          <h1>
            Arc Token Launchpad
          </h1>
          <p className="text-sm text-stone mt-1 max-w-xl">
            Create a coin. Curve trading starts at zero supply.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="btn-secondary text-xs py-2 px-3 flex items-center gap-2"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 size={14} />
            <span>Market Config</span>
          </button>

          <button
            className="btn-primary py-2.5 px-5"
            disabled={busy || !validFactory}
            onClick={() => {
              setCreating(!creating);
              setSelected(undefined);
            }}
          >
            <Rocket size={16} />
            <span>{creating ? "Cancel Creation" : "+ Launch a Coin"}</span>
          </button>
        </div>
      </div>

      {/* Market Settings Drawer / Details */}
      {showSettings && (
        <FormDialog open={showSettings} onOpenChange={setShowSettings} busy={busy} title="Market settings" description="Choose the public launch market.">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-chalk flex items-center gap-2">
              <Settings2 size={16} className="text-spring" />
              <span>Launchpad Market Configuration</span>
            </h3>
            <button
              className="text-stone hover:text-chalk"
              onClick={() => setShowSettings(false)}
            >
              <X size={16} />
            </button>
          </div>

          <div className="text-xs text-chalk space-y-2 mb-4">
            <p>
              Current Market Address:{" "}
              {validFactory ? (
                <a
                  href={`https://testnet.arcscan.app/address/${factory}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-spring underline"
                >
                  {factory} ↗
                </a>
              ) : (
                <span className="text-warn">Not configured</span>
              )}
            </p>
            <p className="text-stone">
              The bonding curve formula begins at 0.000001 USDC and scales linearly up to a 1,000,000 whole-token cap.
            </p>
          </div>

          {!configured && (
            <form
              className="flex flex-col sm:flex-row gap-3 max-w-xl"
              onSubmit={async e => {
                e.preventDefault();
                if (!isAddress(marketInput)) {
                  setError("Enter a valid market contract address.");
                  return;
                }
                try {
                  await client.readContract({
                    address: marketInput,
                    abi: curveLaunchpad.abi,
                    functionName: "tokenCount",
                  });
                  localStorage.setItem(storageKey, marketInput);
                  window.dispatchEvent(new Event("mofu-market"));
                  setSelected(undefined);
                  setPage(0);
                  setError("");
                  setShowSettings(false);
                } catch {
                  setError("Could not read this market on Arc Testnet.");
                }
              }}
            >
              <input
                placeholder="Join existing factory address 0x..."
                value={marketInput}
                onChange={e => setMarketInput(e.target.value)}
                className="text-xs"
              />
              <button className="btn-secondary whitespace-nowrap text-xs">
                Switch Market
              </button>
            </form>
          )}
        </FormDialog>
      )}

      {/* Deploy Market Card if not configured */}
      {!validFactory && (
        <div className="glass-panel p-8 mb-8 border-dashed border-warn/40 text-center max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-xl bg-warn/10 text-warn grid place-items-center mx-auto mb-4">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-xl font-bold text-chalk mb-2">No Market Configured</h2>
          <p className="text-sm text-stone max-w-md mx-auto mb-6">
            Deploy a testnet CurveLaunchpad factory once on Arc Testnet. Once deployed, anyone can create coins and trade against their bonding curves.
          </p>
          <button
            className="btn-primary px-6"
            disabled={busy}
            onClick={() => void run(setupMarket)}
          >
            {busy ? "Deploying Market..." : "Deploy Testnet Launchpad Factory"}
          </button>
        </div>
      )}

      {/* Creation Studio */}
      {creating && (
        <FormDialog open={creating} onOpenChange={setCreating} busy={busy} title="Launch a coin" description="Create a public token on Arc Testnet.">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left side: Form */}
            <form
              className="lg:col-span-7 flex flex-col gap-5"
              onSubmit={e => {
                e.preventDefault();
                void run(create);
              }}
            >
              <div>
                <h2 className="text-xl font-bold text-chalk flex items-center gap-2">
                  <Sparkles size={18} className="text-spring" />
                  <span>Launch a New Coin</span>
                </h2>
                <p className="text-xs text-stone mt-1">
                  100% fair launch. No presale, zero creator allocation, zero platform fees.
                </p>
              </div>

              {/* Icon Picker */}
              <div>
                <label htmlFor="coin-image" className="text-xs font-semibold text-chalk mb-2 block">
                  Select Coin Icon
                </label>
                <div className="flex flex-wrap gap-2">
                  {curatedIcons.map(item => (
                    <button
                      type="button"
                      key={item}
                      aria-label={`Use ${tokenArtwork[curatedIcons.indexOf(item)]} artwork`}
                      aria-pressed={icon === item}
                      className={`w-11 h-11 text-xl rounded-xl transition-all border ${
                        icon === item
                          ? "bg-spring/15 border-spring scale-105"
                          : "bg-night border-line hover:border-stone"
                      }`}
                      onClick={() => setIcon(item)}
                    >
                      <TokenImage src={item} size={36} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="coin-image">Image URL</label>
                <input id="coin-image" type="text" value={icon} disabled={busy}
                  onChange={event => setIcon(event.target.value)}
                  placeholder="https://…" aria-describedby="coin-image-help" aria-invalid={!!tokenImageInputError(icon)} />
                <p id="coin-image-help" className="text-xs text-stone mt-1">
                  {tokenImageInputError(icon) || "Choose artwork or use HTTPS. Legacy images are limited to 32 UTF-8 bytes; IPFS URIs do not fit this contract."}
                </p>
              </div>

              {/* Name & Ticker Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label>
                  <span>Coin Name</span>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    maxLength={64}
                    placeholder="e.g. Arc Shiba"
                    required
                  />
                </label>
                <label>
                  <span>Ticker Symbol</span>
                  <input
                    value={symbol}
                    onChange={e => setSymbol(e.target.value.toUpperCase())}
                    maxLength={10}
                    pattern="[A-Z0-9]{1,10}"
                    placeholder="e.g. ASHIB"
                    required
                  />
                </label>
              </div>

              {/* Story / Description */}
              <label>
                <div className="flex justify-between">
                  <span>Community Story / Description</span>
                  <span className="text-[10px] text-stone">{description.length}/280</span>
                </div>
                <textarea
                  value={description}
                  maxLength={280}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Tell the community what makes this coin special..."
                  rows={3}
                />
              </label>

              {/* Tokenomics Badges */}
              <div className="grid grid-cols-3 gap-2 py-3 px-4 rounded-xl bg-night border border-line text-center text-xs">
                <div>
                  <span className="text-stone block text-[10px] font-semibold text-stone">Cap</span>
                  <b className="text-chalk">1,000,000</b>
                </div>
                <div>
                  <span className="text-stone block text-[10px] font-semibold text-stone">Premint</span>
                  <b className="text-spring">0 Tokens</b>
                </div>
                <div>
                  <span className="text-stone block text-[10px] font-semibold text-stone">Fee</span>
                  <b className="text-spring">0% Platform</b>
                </div>
              </div>

              <button className="btn-primary w-full py-3" type="submit" disabled={busy || !!tokenImageInputError(icon)}>
                <Rocket size={16} />
                <span>
                  {busy ? "Deploying Token..." : address ? "Deploy & Open Curve" : "Connect Wallet to Launch"}
                </span>
              </button>
            </form>

            {/* Right side: Live Preview Card */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              <span className="text-xs font-semibold text-stone">
                Live Card Preview
              </span>
              <div className="market-card pointer-events-none">
                <div className="market-card-top">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-spring/15 grid place-items-center text-2xl border border-line">
                      <TokenImage src={icon} size={46} />
                    </div>
                    <div>
                      <div className="market-title-row">
                        <h3>{name || "Token Name"}</h3>
                        <span>${symbol || "TICKER"}</span>
                      </div>
                      <span className="market-badge-cat">Community</span>
                    </div>
                  </div>
                </div>

                <p className="market-desc line-clamp-2">
                  {description || "A brand new fair-launch token on Arc Testnet."}
                </p>

                <div className="space-y-1.5 mb-3">
                  <div className="flex justify-between text-xs text-stone">
                    <span>Bonding Progress</span>
                    <span className="font-mono text-spring">0.0%</span>
                  </div>
                  <div className="progress-track">
                      <div className="progress-fill" style={{ width: "2%" }} />
                  </div>
                </div>

                <div className="market-card-footer">
                  <div className="text-xs text-stone">
                    Reserve: <b className="text-chalk">0.00 USDC</b>
                  </div>
                  <span className="text-xs text-spring font-semibold">Just Born</span>
                </div>
              </div>
            </div>
          </div>
        </FormDialog>
      )}

      {/* Search & Feed Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-chalk flex items-center gap-2">
            <Coins size={18} className="text-spring" />
            <span>Live Tokens</span>
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-spring/15 text-spring border font-mono">
            {market.data?.count.toString() ?? "0"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="search-input-wrap flex-1 sm:flex-initial">
            <Search size={15} className="search-icon-pos" />
            <input
              placeholder="Filter by name, ticker, address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="text-xs w-full sm:w-64"
            />
          </div>

          <button
            className="btn-secondary p-2.5 text-xs"
            disabled={!validFactory || market.isFetching}
            onClick={() => void market.refetch()}
            title="Refresh feed"
          >
            <RefreshCw size={14} className={market.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main Grid: Tokens List + Optional Detail Sidebar */}
      <div className="launch-market">
        {/* Token Cards Grid */}
        <div className="w-full">
          {validFactory && market.isPending ? (
            <div className="glass-panel text-center py-20">
              <RefreshCw size={28} className="animate-spin text-spring mx-auto mb-3" />
              <p className="text-sm text-chalk font-medium">Loading coins from Arc Testnet…</p>
            </div>
          ) : market.isError ? (
            <div className="glass-panel text-center py-16 border-ember/30">
              <AlertCircle size={28} className="text-ember mx-auto mb-3" />
              <p className="text-sm text-ember font-medium">
                Could not load market tokens. Check factory address or RPC.
              </p>
              <button className="btn-secondary text-xs mt-4" onClick={() => void market.refetch()}>
                Retry connection
              </button>
            </div>
          ) : tokens.length === 0 ? (
            <div className="glass-panel text-center py-20 px-4 border-dashed">
              <div className="w-12 h-12 rounded-2xl bg-spring/10 text-spring grid place-items-center mx-auto mb-3">
                <Coins size={24} />
              </div>
              <h3 className="text-lg font-bold text-chalk">
                {search ? "No coins match your filter" : "No coins launched in this market yet"}
              </h3>
              <p className="text-sm text-stone max-w-sm mx-auto mt-1">
                {search
                  ? "Try searching for a different ticker or address."
                  : "Be the very first community to deploy a fair-curve coin!"}
              </p>
              {!search && validFactory && (
                <button className="btn-primary text-xs mt-4" onClick={() => setCreating(true)}>
                  <Rocket size={14} />
                  <span>Create First Coin</span>
                </button>
              )}
            </div>
          ) : (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`}>
              {tokens.map(token => {
                const isSelected = active?.address === token.address;
                const percent = (Number(token.supply) / 10000).toFixed(1);
                return (
                  <div
                    key={token.address}
                    className={`market-card cursor-pointer ${isSelected ? "border-spring bg-night" : ""}`}
                    role="button"
                    tabIndex={busy ? -1 : 0}
                    aria-label={`Select ${token.name}`}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
                    onClick={() => {
                      if (busy) return;
                      setSelected(token);
                      setCreating(false);
                      setSide("buy");
                      setAmount("1000");
                    }}
                  >
                    <div className="market-card-top">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-spring/15 border border-line grid place-items-center text-2xl">
                          <TokenImage src={token.icon} size={46} />
                        </div>
                        <div>
                          <div className="market-title-row">
                            <h3 className="truncate max-w-[120px]">{token.name}</h3>
                            <span className="font-mono">${token.symbol}</span>
                          </div>
                          <span className="text-[10px] text-stone font-mono">
                            {token.address.slice(0, 6)}…{token.address.slice(-4)}
                          </span>
                        </div>
                      </div>
                      <span className="text-spring text-sm font-semibold">Trade ↗</span>
                    </div>

                    <p className="market-desc line-clamp-2">
                      {token.description || "Fair launch coin on Arc."}
                    </p>

                    {/* Bonding Progress */}
                    <div className="space-y-1.5 mb-3">
                      <div className="flex justify-between text-[11px] text-stone">
                        <span>Curve Progress</span>
                        <span className="font-mono text-spring font-semibold">{percent}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill"
                          style={{ width: `${Math.max(2, Math.min(100, Number(percent)))}%` }}
                        />
                      </div>
                    </div>

                    <div className="market-card-footer">
                      <div className="text-xs text-stone">
                        Reserve: <b className="text-chalk font-mono">{compact(token.reserve)} USDC</b>
                      </div>
                      <span className="text-[10px] text-stone font-mono">
                        by {token.creator.slice(0, 4)}…{token.creator.slice(-4)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {market.data && market.data.count > 12n && (
            <div className="ob-pager mt-6">
              <button disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>
                ← Newer Coins
              </button>
              <span>Page {page + 1}</span>
              <button
                disabled={BigInt((page + 1) * 12) >= market.data.count || busy}
                onClick={() => setPage(page + 1)}
              >
                Older Coins →
              </button>
            </div>
          )}
        </div>

        {/* Selected Token Trading Sidebar */}
        {active && (
          <FormDialog open={!!active} onOpenChange={open => { if (!open) setSelected(undefined); }} busy={busy} title={active.name} description="Review the token and trade its curve.">
            <div className="glass-panel p-6">
              {/* Token Header */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-spring/15 border border-line grid place-items-center text-3xl">
                    <TokenImage src={active.icon} size={54} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-chalk leading-tight">
                      {active.name}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-mono text-spring font-bold">${active.symbol}</span>
                      <a
                        href={`https://testnet.arcscan.app/token/${active.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-stone hover:text-chalk flex items-center gap-1 font-mono"
                      >
                        <span>{active.address.slice(0, 6)}…{active.address.slice(-4)}</span>
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                </div>

                <button
                  className="p-1.5 rounded-lg bg-surface text-stone hover:text-chalk transition-colors"
                  onClick={() => setSelected(undefined)}
                  aria-label="Close panel"
                >
                  <X size={16} />
                </button>
              </div>

              {active.description && (
                <p className="text-xs text-chalk leading-relaxed mb-4 bg-night p-3 rounded-xl border border-line">
                  {active.description}
                </p>
              )}

              {/* Bonding Curve Metrics */}
              <div className="p-3.5 rounded-xl bg-night border border-line mb-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-stone">Curve Reserve:</span>
                  <b className="text-chalk font-mono">{compact(active.reserve)} USDC</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone">Minted Supply:</span>
                  <b className="text-chalk font-mono">{active.supply.toLocaleString()} / 1,000,000</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone">Your Wallet Balance:</span>
                  <b className="text-spring font-mono">
                    {address
                      ? holding.isError
                        ? "Unavailable"
                        : holding.data !== undefined
                        ? compact(holding.data)
                        : "…"
                      : "Connect wallet"}
                  </b>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5 mb-5">
                <div className="flex justify-between text-[11px] text-stone">
                  <span>Bonding Progress</span>
                  <span className="font-mono text-spring font-bold">
                    {(Number(active.supply) / 10000).toFixed(1)}%
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill"
                    style={{ width: `${Math.max(2, Math.min(100, Number(active.supply) / 10000))}%` }}
                  />
                </div>
              </div>

              {/* Buy / Sell Tab Switcher */}
              <div className="ob-toggle mb-4">
                <button
                  type="button"
                  className={side === "buy" ? "active" : ""}
                  onClick={() => setSide("buy")}
                >
                  Buy {active.symbol}
                </button>
                <button
                  type="button"
                  className={side === "sell" ? "active ob-sell" : ""}
                  onClick={() => setSide("sell")}
                >
                  Sell {active.symbol}
                </button>
              </div>

              {/* Amount Input */}
              <div className="space-y-3 mb-5">
                <label>
                  <span className="text-xs font-semibold text-chalk">
                    Amount in Whole Tokens
                  </span>
                  <input
                    inputMode="numeric"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="1000"
                  />
                </label>

                {/* Preset Chips */}
                <div className="grid grid-cols-4 gap-2">
                  {[100, 1000, 10000, 50000].map(n => (
                    <button
                      key={n}
                      type="button"
                      className="py-1.5 px-2 rounded-lg bg-night border border-line hover:text-xs font-semibold text-chalk text-center"
                      onClick={() => setAmount(String(n))}
                    >
                      +{n >= 1000 ? `${n / 1000}k` : n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Quote Breakdown */}
              <div className="p-3.5 rounded-xl bg-night border border-line space-y-2 text-xs mb-5">
                <div className="flex justify-between items-center">
                  <span className="text-stone">
                    {side === "buy" ? "Estimated USDC Cost" : "Estimated USDC Return"}:
                  </span>
                  <strong className="text-chalk text-sm font-mono">
                    {quote.isError || !quantity
                      ? "Unavailable"
                      : quote.data
                      ? `${compact(quote.data.value)} USDC`
                      : "Calculating…"}
                  </strong>
                </div>
                <div className="text-[10px] text-stone flex justify-between">
                  <span>Slippage Protection: 1%</span>
                  <span>Gas: Paid in native USDC</span>
                </div>
              </div>

              {/* Action Button */}
              <button
                className={`w-full py-3 ${
                  side === "sell" ? "btn-rose" : "btn-emerald"
                }`}
                disabled={busy || (!!address && (!quote.data || quote.isError || !quantity))}
                onClick={() => void run(trade)}
              >
                {busy
                  ? "Confirming Onchain…"
                  : !address
                  ? "Connect Wallet"
                  : `${side === "buy" ? "Buy" : "Sell"} ${quantity ? quantity.toLocaleString() : ""} ${active.symbol}`}
              </button>

              {onSwap && active.index !== undefined && <Button size="3" variant="soft" style={{ width: "100%", marginTop: 12 }} disabled={busy} onClick={() => onSwap({ ...active, index: active.index! })}>Swap {active.symbol} with USDC</Button>}
              {/* Quick Jump to Limit Orders */}
              {onTradePair && active.index !== undefined && (
                <button
                  className="w-full mt-2.5 py-2 text-xs text-stone hover:text-chalk flex items-center justify-center gap-1.5 transition-colors"
                  disabled={busy}
                  onClick={() => onTradePair({ ...active, index: active.index! })}
                >
                  <TrendingUp size={13} />
                  <span>Place Limit Orders on OrderBook →</span>
                </button>
              )}
            </div>
          </FormDialog>
        )}
      </div>

      {/* Transaction & Feedback Alerts */}
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
