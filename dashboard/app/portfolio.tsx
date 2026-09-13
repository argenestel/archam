"use client";
import { OnchainTokenImage } from "./token-image";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { isAddress } from "viem";
import {
  Wallet,
  Coins,
  TrendingUp,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  Rocket,
  Droplets
} from "lucide-react";
import { curveToken } from "./generated/curveToken";
import { orderBook } from "./generated/orderBook";
import { arcClient, money, readTokens, short, useMarketAddresses } from "./market-data";
import "./orderbook.css";
import type { MarketToken } from "./market-data";
import { Button } from "@radix-ui/themes";

export function Portfolio({
  onNavigate,
  onCoin,
}: {
  onNavigate: (tab: "Launch" | "Trade" | "Bridge") => void;
  onCoin?: (tab: "Trade" | "Swap", token: MarketToken) => void;
}) {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { factory, book } = useMarketAddresses();

  const balance = useQuery({
    queryKey: ["portfolio-balance", address],
    enabled: !!address,
    refetchInterval: 15000,
    queryFn: () => arcClient.getBalance({ address: address! }),
  });

  const holdings = useQuery({
    queryKey: ["portfolio-holdings", address, factory],
    enabled: !!address && isAddress(factory),
    refetchInterval: 20000,
    queryFn: async () => {
      const market = await readTokens(factory, 0, 40);
      const balances = await arcClient.multicall({
        allowFailure: false,
        contracts: market.tokens.map(
          token =>
            ({
              address: token.address,
              abi: curveToken.abi,
              functionName: "balanceOf",
              args: [address!],
            } as const)
        ),
      });
      return {
        count: market.count,
        checked: market.tokens.length,
        tokens: market.tokens
          .map((token, i) => ({ ...token, balance: balances[i] }))
          .filter(t => t.balance > 0n),
      };
    },
  });

  const credit = useQuery({
    queryKey: ["portfolio-credit", address, factory, book],
    enabled: !!address && isAddress(book) && isAddress(factory),
    refetchInterval: 15000,
    queryFn: async () => {
      if (!isAddress(book)) throw new Error("No orderbook selected.");
      const linked = await arcClient.readContract({
        address: book,
        abi: orderBook.abi,
        functionName: "factory",
      });
      if (linked.toLowerCase() !== factory.toLowerCase()) {
        throw new Error("Orderbook market mismatch.");
      }
      return arcClient.readContract({
        address: book,
        abi: orderBook.abi,
        functionName: "credits",
        args: [address!],
      });
    },
  });

  return (
    <section className="pf-section">
      {/* Header */}
      <div className="ob-heading">
        <div>
          <h1>Your Arc Assets</h1>
          <p>
            Balances, holdings, and settlement credit.
          </p>
        </div>

        {address && (
          <a
            className="ob-network"
            href={`https://testnet.arcscan.app/address/${address}`}
            target="_blank"
            rel="noreferrer"
            title="View wallet on ArcScan"
          >
            <span>{short(address)}</span>
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {!address ? (
        /* Not connected state */
        <div className="pf-connect">
          <div className="pf-connect-icon">
            <Wallet size={28} />
          </div>
          <h2>Connect your wallet</h2>
          <p>
            Connect any EVM wallet on Arc Testnet to inspect real token holdings,
            available USDC trading proceeds, and launch activity.
          </p>
          <button className="btn-primary" onClick={() => openConnectModal?.()}>
            <Wallet size={16} />
            <span>Connect Wallet</span>
          </button>
        </div>
      ) : (
        <>
          {/* Executive Stat Cards (3 Cards) */}
          <div className="pf-stats-grid">
            {/* Card 1: Native USDC Balance */}
            <div className="pf-stat-card">
              <div className="pf-stat-top">
                <span className="pf-stat-label">Native USDC Balance</span>
                <span className="p-2 rounded-lg bg-spring/10 text-spring">
                  <Wallet size={18} />
                </span>
              </div>
              <div className="pf-stat-value font-mono">
                {balance.isError
                  ? "Unavailable"
                  : balance.data !== undefined
                  ? money(balance.data)
                  : "…"}
                <small>USDC</small>
              </div>
              <p className="pf-stat-sub">
                Native network currency on Arc Testnet, used for trading and gas fees.
              </p>
              <div className="pf-stat-action flex gap-2">
                <button
                  className="btn-secondary text-xs py-2 px-3.5 flex-1"
                  onClick={() => onNavigate("Bridge")}
                >
                  <ArrowUpRight size={14} />
                  <span>Bridge USDC</span>
                </button>
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-xs py-2 px-3"
                  title="Claim test USDC"
                >
                  <Droplets size={14} />
                </a>
              </div>
            </div>

            {/* Card 2: Withdrawable Credits */}
            <div className="pf-stat-card">
              <div className="pf-stat-top">
                <span className="pf-stat-label">OrderBook Credits</span>
                <span className="p-2 rounded-lg bg-spring/10 text-spring">
                  <TrendingUp size={18} />
                </span>
              </div>
              <div className="pf-stat-value font-mono">
                {credit.isError
                  ? "Unavailable"
                  : credit.data !== undefined
                  ? money(credit.data)
                  : isAddress(book)
                  ? "…"
                  : "0"}
                <small>USDC</small>
              </div>
              <p className="pf-stat-sub">
                Settled sale proceeds and returned escrow from cancelled limit orders.
              </p>
              <div className="pf-stat-action">
                <button
                  className="btn-primary text-xs py-2 px-4 w-full"
                  onClick={() => onNavigate("Trade")}
                >
                  <span>Open Settlement Vault →</span>
                </button>
              </div>
            </div>

            {/* Card 3: Coins in Wallet */}
            <div className="pf-stat-card">
              <div className="pf-stat-top">
                <span className="pf-stat-label">Community Coins</span>
                <span className="p-2 rounded-lg bg-spring/10 text-spring">
                  <Coins size={18} />
                </span>
              </div>
              <div className="pf-stat-value font-mono">
                {holdings.isError
                  ? "Unavailable"
                  : holdings.data
                  ? holdings.data.tokens.length
                  : isAddress(factory)
                  ? "…"
                  : "0"}
                <small>Tokens</small>
              </div>
              <p className="pf-stat-sub">
                Tokens held among the latest 40 coins deployed in your active launch market.
              </p>
              <div className="pf-stat-action">
                <button
                  className="btn-secondary text-xs py-2 px-4 w-full"
                  onClick={() => onNavigate("Launch")}
                >
                  <Rocket size={14} />
                  <span>Explore Launchpad →</span>
                </button>
              </div>
            </div>
          </div>

          {/* Holdings List Section */}
          <div className="pf-holdings-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-spring" />
                <h2 className="text-base font-bold text-chalk">Your Coin Holdings</h2>
              </div>
              <button
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                disabled={holdings.isFetching || !isAddress(factory)}
                onClick={() => void holdings.refetch()}
              >
                <RefreshCw size={12} className={holdings.isFetching ? "animate-spin" : ""} />
                <span>Refresh</span>
              </button>
            </div>

            {holdings.isError ? (
              <div className="p-4 rounded-xl bg-ember/10 border border-ember/30 text-ember text-xs">
                Could not load token balances. Check your network connection.
              </div>
            ) : !isAddress(factory) ? (
              <div className="ob-empty py-12">
                <span className="text-sm font-semibold text-chalk">
                  No active launch market selected.
                </span>
                <span className="text-xs text-stone">
                  Select or deploy a market in Launch to discover coins.
                </span>
              </div>
            ) : holdings.isPending ? (
              <div className="py-12 text-center text-sm text-stone flex items-center justify-center gap-2">
                <RefreshCw size={16} className="animate-spin text-spring" />
                <span>Scanning Arc Testnet balances…</span>
              </div>
            ) : holdings.data.tokens.length ? (
              <div className="overflow-x-auto">
                <table className="pro-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Contract</th>
                      <th className="text-right">Wallet Balance</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.data.tokens.map(token => (
                      <tr key={token.address}>
                        <td>
                          <div className="pf-token-cell">
                            <div className="pf-token-icon"><OnchainTokenImage address={token.address} size={36} /></div>
                            <div>
                              <b className="text-chalk block text-sm">{token.name}</b>
                              <span className="text-xs text-spring font-mono font-semibold">
                                ${token.symbol}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <a
                            href={`https://testnet.arcscan.app/token/${token.address}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-stone hover:text-chalk flex items-center gap-1"
                          >
                            <span>{short(token.address)}</span>
                            <ExternalLink size={12} />
                          </a>
                        </td>
                        <td className="text-right font-mono text-base font-bold text-chalk">
                          {money(token.balance)}
                        </td>
                        <td className="text-right">
                          <div className="inline-flex gap-2">
                            <button
                              className="btn-secondary text-xs py-1 px-2.5"
                              onClick={() => onCoin ? onCoin("Trade", token) : onNavigate("Trade")}
                            >
                              Limit Order
                            </button>
                            <Button size="1" onClick={() => onCoin ? onCoin("Swap", token) : onNavigate("Launch")}>Swap</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ob-empty py-12">
                <span className="text-sm font-semibold text-chalk">No coin balances detected</span>
                <span className="text-xs text-stone max-w-sm">
                  You haven&apos;t bought any tokens in this market yet. Buy on the curve or place limit bids in the orderbook!
                </span>
                <button className="btn-primary text-xs mt-3" onClick={() => onNavigate("Launch")}>
                  <Rocket size={14} />
                  <span>Discover Coins on Launchpad</span>
                </button>
              </div>
            )}

            <p className="ob-caption mt-4">
              Scope: Evaluates balances across the latest 40 deployed tokens in your active factory. External tokens and tokens escrowed in active limit orders are excluded.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
