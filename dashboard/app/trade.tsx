"use client";
import { TokenImage, tokenImagePath } from "./token-image";
import { TokenPicker, type PickerToken } from "./token-picker";
import { ARC_EURC, ARC_USDC } from "./arc-token-discovery";

import { useRef, useState } from "react";
import { Button, IconButton } from "@radix-ui/themes";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { parseUnits, type EIP1193Provider } from "viem";
import type { AppKit, BridgeResult } from "@circle-fin/app-kit";
import {
  ArrowDown,
  AlertCircle,
  Check,
  RefreshCw
} from "lucide-react";

const networks = ["Arc_Testnet", "Ethereum_Sepolia", "Base_Sepolia"] as const;
const stablecoinTokens: PickerToken[] = [
  { address: ARC_USDC, name: "USD Coin", symbol: "USDC", decimals: 6, image: "/token-images/usdc.svg", status: "route", statusLabel: "Circle swap" },
  { address: ARC_EURC, name: "Euro Coin", symbol: "EURC", decimals: 6, image: "/token-images/eurc.svg", status: "route", statusLabel: "Circle swap" },
];
const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );

export function Trade({
  mode,
  onBusy,
}: {
  mode: "Swap" | "Bridge";
  onBusy: (busy: boolean) => void;
}) {
  const { address, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [amount, setAmount] = useState("10");
  const [reverse, setReverse] = useState(false);
  const [assetPicker, setAssetPicker] = useState<"input" | "output" | null>(null);
  const [source, setSource] = useState(1);
  const [destination, setDestination] = useState(0);
  const [slippage, setSlippage] = useState("50");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const kitRef = useRef<AppKit | null>(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [details, setDetails] = useState<unknown>();
  const [links, setLinks] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<{ owner: string; result: BridgeResult }>();
  const [quote, setQuote] = useState<{
    key: string;
    expiry: number;
    output?: string;
    minimum?: string;
  }>();

  const key = [mode, address, amount, reverse, source, destination, slippage].join(":");
  const current = quote?.key === key ? quote : undefined;

  const input = reverse ? "EURC" : "USDC";
  const output = reverse ? "USDC" : "EURC";

  function selectStablecoin(token: PickerToken) {
    if (mode !== "Swap" || !assetPicker) return;
    const nextInput = assetPicker === "input" ? token.symbol : token.symbol === "USDC" ? "EURC" : "USDC";
    setReverse(nextInput === "EURC");
    setQuote(undefined);
    setAssetPicker(null);
  }

  async function context() {
    if (!connector) throw new Error("Connect your wallet first.");
    const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([
      import("@circle-fin/app-kit"),
      import("@circle-fin/adapter-viem-v2"),
    ]);
    if (!kitRef.current) {
      kitRef.current = new AppKit();
      kitRef.current.on("*", event => {
        if ("method" in event) {
          setMessage(`Circle: ${String(event.method)}. Review your wallet prompt.`);
        }
      });
    }
    return {
      kit: kitRef.current,
      adapter: await createViemAdapterFromProvider({
        provider: (await connector.getProvider()) as EIP1193Provider,
      }),
    };
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
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
      setMessage("Check any submitted transactions before trying again.");
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  function bridgeResult(result: BridgeResult) {
    setDetails(result);
    setLinks(result.steps.flatMap(step => (step.explorerUrl ? [step.explorerUrl] : [])));
    setRecovery(result.state === "success" ? undefined : { owner: address!, result });
    setMessage(
      result.state === "success"
        ? "Bridge complete."
        : `Bridge status: ${result.state}. Save recovery rather than sending again.`
    );
  }

  async function submit() {
    if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) {
      throw new Error("Enter a positive amount, up to 6 decimal places.");
    }
    if (mode === "Bridge" && source === destination) {
      throw new Error("Choose two different networks.");
    }
    if (current && current.expiry < Date.now()) {
      setQuote(undefined);
      throw new Error("Estimate expired. Please request a fresh estimate.");
    }

    setMessage(current ? "Confirm transaction in your wallet…" : "Requesting Circle estimate…");
    const { kit, adapter } = await context();

    if (mode === "Swap") {
      const params = {
        from: { adapter, chain: "Arc_Testnet" as const },
        tokenIn: input,
        tokenOut: output,
        amountIn: amount,
        config: {
          slippageBps: Number(slippage),
          allowanceStrategy: "approve" as const,
          ...(current?.minimum ? { stopLimit: current.minimum } : {}),
        },
      };
      if (!current) {
        const result = await kit.estimateSwap(params);
        setQuote({
          key,
          expiry: Date.now() + 60000,
          output: result.estimatedOutput.amount,
          minimum: result.stopLimit.amount,
        });
        setDetails(result);
        setLinks([]);
        setMessage("Estimate received. Valid for 60 seconds.");
      } else {
        setQuote(undefined);
        const result = await kit.swap(params);
        setDetails(result);
        setLinks(result.explorerUrl ? [result.explorerUrl] : []);
        setMessage(`Swap status: ${result.progress.status.toLowerCase()}.`);
        if (result.progress.status === "PENDING") {
          const final = await kit.waitForSwap({ result });
          setDetails(final);
          setMessage(`Swap ${final.progress.status.toLowerCase()}.`);
        }
      }
    } else {
      const params = {
        from: { adapter, chain: networks[source] },
        to: { adapter, chain: networks[destination] },
        amount,
      };
      if (!current) {
        const result = await kit.estimateBridge(params);
        setDetails(result);
        setLinks([]);
        if (
          result.fees.some(f => f.error || f.amount === null) ||
          result.gasFees.some(f => f.error || f.fees === null)
        ) {
          throw new Error("Unable to estimate all fees. Check network endpoints and retry.");
        }
        const fees = result.fees.reduce(
          (total, fee) => total + parseUnits(fee.amount!, 6),
          0n
        );
        const { formatUnits } = await import("viem");
        setQuote({
          key,
          expiry: Date.now() + 60000,
          output: formatUnits(parseUnits(amount, 6) - fees, 6),
        });
        setMessage("Bridge fees calculated. Review the summary below.");
      } else {
        setQuote(undefined);
        bridgeResult(await kit.bridge(params));
      }
    }
  }

  return (
    <section className="py-6 max-w-lg mx-auto">
      {/* Heading */}
      <div className="text-center mb-8">
        <h1>
          {mode === "Swap" ? "Swap stablecoins" : "Bridge USDC"}
        </h1>
        <p className="text-sm text-stone mt-2">
          {mode === "Swap"
            ? "USDC ↔ EURC on Arc."
            : "USDC across supported testnets."}
        </p>
      </div>

      {/* Main Card */}
      <div className="glass-panel p-6 sm:p-8 relative">
        <fieldset disabled={busy} className="space-y-4">
          {/* Bridge Network Route */}
          {mode === "Bridge" && (
            <div className="grid grid-cols-2 gap-3 mb-2">
              <label>
                <span className="text-xs font-semibold text-chalk">From Network</span>
                <select
                  value={source}
                  onChange={e => {
                    setSource(+e.target.value);
                    setQuote(undefined);
                  }}
                  className="text-xs font-semibold"
                >
                  {networks.map((n, i) => (
                    <option key={n} value={i}>
                      {n.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-xs font-semibold text-chalk">To Network</span>
                <select
                  value={destination}
                  onChange={e => {
                    setDestination(+e.target.value);
                    setQuote(undefined);
                  }}
                  className="text-xs font-semibold"
                >
                  {networks.map((n, i) => (
                    <option key={n} value={i}>
                      {n.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Pay Input Box */}
          <div className="p-4 rounded-xl bg-night border border-line space-y-2">
            <div className="flex items-center justify-between text-xs text-stone font-semibold">
              <span>You Pay</span>
              <span>{mode === "Swap" ? "Arc Testnet" : "USDC"}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <input
                id="trade-amount"
                inputMode="decimal"
                value={amount}
                onChange={e => {
                  setAmount(e.target.value);
                  setQuote(undefined);
                }}
                className="w-full bg-transparent border-0 p-0 text-3xl font-bold text-chalk focus:ring-0 focus:border-0 font-mono"
                placeholder="0.00"
              />
              {mode === "Swap" ? (
                <button type="button" className="trade-token-button" aria-label="Pay token" onClick={() => setAssetPicker("input")}>
                  <TokenImage src={tokenImagePath(input.toLowerCase())} size={22} />
                  <span>{input}</span>
                  <span aria-hidden>⌄</span>
                </button>
              ) : (
                <span className="trade-token-button"><TokenImage src={tokenImagePath("usdc")} size={22} /><span>USDC</span></span>
              )}
            </div>
          </div>

          {/* Flip Direction Button */}
          <div className="flex justify-center -my-2 relative z-10">
            <IconButton
              type="button"
              size="3"
              variant="soft"
              aria-label="Reverse direction"
              onClick={() => {
                setQuote(undefined);
                if (mode === "Swap") {
                  setReverse(!reverse);
                } else {
                  const s = source;
                  setSource(destination);
                  setDestination(s);
                }
              }}
            >
              <ArrowDown size={18} />
            </IconButton>
          </div>

          {/* Receive Box */}
          <div className="p-4 rounded-xl bg-night border border-line space-y-2">
            <div className="flex items-center justify-between text-xs text-stone font-semibold">
              <span>Estimated Receive</span>
              {current?.minimum && (
                <span className="text-[10px] text-spring">
                  Min: {current.minimum} {output}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-3xl font-extrabold font-mono text-chalk">
                {current?.output ?? "—"}
              </span>
              {mode === "Swap" ? (
                <button type="button" className="trade-token-button" aria-label="Receive token" onClick={() => setAssetPicker("output")}>
                  <TokenImage src={tokenImagePath(output.toLowerCase())} size={22} />
                  <span>{output}</span>
                  <span aria-hidden>⌄</span>
                </button>
              ) : (
                <span className="trade-token-button"><TokenImage src={tokenImagePath("usdc")} size={22} /><span>USDC</span></span>
              )}
            </div>
          </div>

          {/* Slippage Settings (Swap mode) */}
          {mode === "Swap" && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-stone font-semibold">Max Slippage</span>
              <div className="flex items-center gap-1.5">
                {[
                  { label: "0.1%", val: "10" },
                  { label: "0.5%", val: "50" },
                  { label: "1.0%", val: "100" },
                ].map(item => (
                  <button
                    key={item.val}
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                      slippage === item.val
                        ? "bg-spring/15 border-spring text-spring"
                        : "bg-night border-line text-stone hover:text-chalk"
                    }`}
                    onClick={() => {
                      setSlippage(item.val);
                      setQuote(undefined);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button
            size="3"
            className="w-full mt-4"
            disabled={busy || (mode === "Bridge" && !!recovery)}
            onClick={() => void run(submit)}
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <RefreshCw size={16} className="animate-spin" />
                <span>Processing with Circle…</span>
              </span>
            ) : !address ? (
              "Connect Wallet"
            ) : current ? (
              `Confirm ${mode}`
            ) : (
              `Review ${mode.toLowerCase()} quote`
            )}
          </Button>

          {current && (
            <button
              type="button"
              className="w-full text-center text-xs text-stone hover:text-chalk py-1 transition-colors"
              onClick={() => setQuote(undefined)}
            >
              Reset Quote
            </button>
          )}
        </fieldset>

        {mode === "Swap" && (
          <TokenPicker
            open={assetPicker !== null}
            onOpenChange={open => { if (!open) setAssetPicker(null); }}
            busy={busy}
            title="Choose a stablecoin"
            description="Circle supports USDC and EURC swaps on Arc Testnet."
            tokens={stablecoinTokens}
            selected={assetPicker === "input" ? (input === "USDC" ? ARC_USDC : ARC_EURC) : (output === "USDC" ? ARC_USDC : ARC_EURC)}
            onSelect={selectStablecoin}
          />
        )}

        <p className="text-[11px] text-stone text-center mt-5 leading-relaxed">
          {mode === "Swap"
            ? "Testnet pool liquidity is provided by Circle. Check slippage rate before executing."
            : "CCTP burns on the origin chain and mints canonical native USDC on the destination chain."}
        </p>

        {/* Notifications & Explorer Links */}
        {(message || error) && (
          <div className={`status-toast in-flow ${error ? "error" : ""}`} role="status">
            <div className="flex items-start gap-2">
              <div className="mt-0.5">
                {error ? <AlertCircle size={16} /> : <Check size={16} className="text-spring" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{message}</p>
                {error && <p className="text-xs mt-1 text-ember">{error}</p>}
                {links.filter(l => l.startsWith("https://")).map((link, i) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs mt-2 text-spring underline block"
                  >
                    <span>View Circle Transaction #{i + 1} ↗</span>
                  </a>
                ))}
                {details != null && (
                  <details className="mt-2 text-xs text-stone">
                    <summary className="cursor-pointer font-semibold text-chalk">
                      Technical execution details
                    </summary>
                    <pre className="p-3 mt-2 rounded-lg bg-night text-[10px] overflow-auto max-h-48 text-stone font-mono">
                      {json(details)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recovery Drawer */}
        {recovery && (
          <div className="status-toast in-flow mt-4">
            <p className="font-semibold">Incomplete Bridge Session Detected</p>
            <p className="text-xs text-chalk mt-1">
              Keep this session open to resume your CCTP transfer, or save your recovery credentials.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                className="btn-primary text-xs py-1.5 px-3"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (address !== recovery.owner) throw new Error("Reconnect the original wallet.");
                    const { kit, adapter } = await context();
                    bridgeResult(await kit.retryBridge(recovery.result, { from: adapter, to: adapter }));
                  })
                }
              >
                Resume Transfer
              </button>
              <button
                className="btn-secondary text-xs py-1.5 px-3"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([json(recovery)], { type: "application/json" })
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "bridge-recovery.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Save JSON
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
