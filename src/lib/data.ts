import { erc20Abi, type Address, type Hex } from 'viem';
import { client } from './arc';
import {
  deployments,
  faucetAbi,
  irmAbi,
  launchAbi,
  launchConfig,
  morphoAbi,
  oracleAbi,
  pairAbi,
  type MarketParams,
  type Token,
} from './contracts';
import { curvePrice, curveProgress, points, rateToApy, toAssetsDown, toAssetsUp, utilization } from './math';
import { useQuery } from './query';

export type Launch = {
  address: Address;
  name: string;
  symbol: string;
  creator: Address;
  createdAt: number;
  lastTradeAt: number;
  graduated: boolean;
  virtualQuote: bigint;
  virtualToken: bigint;
  realQuote: bigint;
  tokensLeft: bigint;
  volume: bigint;
  trades: number;
  pair: Address;
  image: string;
  description: string;
  price: number;
  marketCap: number;
  progress: number;
};
export type FeedTrade = {
  id: string;
  token: Address;
  trader: Address;
  time: number;
  isBuy: boolean;
  quoteAmount: bigint;
  tokenAmount: bigint;
};
export type Trader = {
  address: Address;
  volume: bigint;
  spent: bigint;
  received: bigint;
  trades: number;
  launches: number;
  firstTradeAt: number;
  points: number;
  pnl?: number;
};

const launch = deployments.launch;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

async function fetchLaunch(address: Address): Promise<Launch> {
  const [curve, name, symbol] = await Promise.all([
    client.readContract({ address: launch!, abi: launchAbi, functionName: 'curves', args: [address] }),
    client.readContract({ address, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
  ]);
  const [creator, createdAt, lastTradeAt, graduated, vq, vt, realQuote, tokensLeft, volume, trades, pair, image, description] =
    curve;
  let price = curvePrice(vq, vt);
  if (graduated && pair !== ZERO) {
    // After graduation the AMM is the market; read its reserves for the live price.
    const [[r0, r1], token0] = await Promise.all([
      client.readContract({ address: pair, abi: pairAbi, functionName: 'getReserves' }),
      client.readContract({ address: pair, abi: pairAbi, functionName: 'token0' }),
    ]);
    const [tok, quote] = token0.toLowerCase() === address.toLowerCase() ? [r0, r1] : [r1, r0];
    price = curvePrice(quote, tok);
  }
  return {
    address,
    name,
    symbol,
    creator,
    createdAt: Number(createdAt),
    lastTradeAt: Number(lastTradeAt),
    graduated,
    virtualQuote: vq,
    virtualToken: vt,
    realQuote,
    tokensLeft,
    volume,
    trades,
    pair,
    image,
    description,
    price,
    marketCap: price * 1e9,
    progress: graduated ? 1 : curveProgress(tokensLeft, launchConfig.saleSupply),
  };
}

export function useLaunches() {
  return useQuery(launch ? 'launches' : null, async () => {
    const addresses = await client.readContract({
      address: launch!,
      abi: launchAbi,
      functionName: 'tokensPage',
      args: [0n, 120n],
    });
    return Promise.all(addresses.map(fetchLaunch));
  });
}

export function useLaunch(address?: Address) {
  return useQuery(launch && address ? `launch:${address}` : null, () => fetchLaunch(address!), 8_000);
}

export function useFeed(token?: Address, limit = 40) {
  return useQuery(
    launch ? `feed:${token ?? 'all'}:${limit}` : null,
    async () => {
      const [page, ids] = await client.readContract({
        address: launch!,
        abi: launchAbi,
        functionName: 'tradesPage',
        args: [token ?? ZERO, 0n, BigInt(limit)],
      });
      return page.map((t, i) => ({
        id: ids[i].toString(),
        token: t.token,
        trader: t.trader,
        time: Number(t.time),
        isBuy: t.isBuy,
        quoteAmount: t.quoteAmount,
        tokenAmount: t.tokenAmount,
      })) satisfies FeedTrade[];
    },
    5_000,
  );
}

export function useTraders(prices: Map<string, number> | undefined) {
  return useQuery(
    launch && prices ? `traders:${prices.size}` : null,
    async () => {
      const [accounts, values] = await client.readContract({
        address: launch!,
        abi: launchAbi,
        functionName: 'tradersPage',
        args: [0n, 250n],
      });
      const positions = await Promise.all(
        accounts.map((a) =>
          client.readContract({ address: launch!, abi: launchAbi, functionName: 'positionsOf', args: [a] }),
        ),
      );
      return accounts.map((address, i) => {
        const s = values[i];
        const [held, , balances] = positions[i];
        // Mark-to-market: quote received + current value of holdings − quote spent.
        const holdings = held.reduce(
          (sum, token, j) => sum + (prices!.get(token.toLowerCase()) ?? 0) * (Number(balances[j]) / 1e18),
          0,
        );
        return {
          address,
          volume: s.volume,
          spent: s.spent,
          received: s.received,
          trades: s.trades,
          launches: s.launches,
          firstTradeAt: Number(s.firstTradeAt),
          points: points({ trades: s.trades, volume: s.volume, launches: s.launches }),
          pnl: (Number(s.received) - Number(s.spent)) / 1e6 + holdings,
        } satisfies Trader;
      });
    },
    20_000,
  );
}

export function usePositions(account?: Address) {
  return useQuery(launch && account ? `positions:${account}` : null, async () => {
    const [held, values, balances] = await client.readContract({
      address: launch!,
      abi: launchAbi,
      functionName: 'positionsOf',
      args: [account!],
    });
    return held.map((token, i) => ({ token, ...values[i], balance: balances[i] }));
  });
}

export function useTraderStats(account?: Address) {
  return useQuery(launch && account ? `stats:${account}` : null, async () => {
    const s = await client.readContract({ address: launch!, abi: launchAbi, functionName: 'stats', args: [account!] });
    const [volume, spent, received, trades, launches, firstTradeAt] = s;
    return {
      volume,
      spent,
      received,
      trades,
      launches,
      firstTradeAt: Number(firstTradeAt),
      points: points({ trades, volume, launches }),
    };
  });
}

export function useBalances(account: Address | undefined, tokens: Token[]) {
  const key = tokens.map((t) => t.address).join(',');
  return useQuery(account ? `balances:${account}:${key}` : null, async () => {
    const values = await Promise.all(
      tokens.map((t) =>
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [account!] }),
      ),
    );
    return Object.fromEntries(tokens.map((t, i) => [t.address.toLowerCase(), values[i]])) as Record<string, bigint>;
  });
}

export function useAllowance(account: Address | undefined, token: Address | undefined, spender: Address | undefined) {
  return useQuery(
    account && token && spender ? `allowance:${account}:${token}:${spender}` : null,
    () =>
      client.readContract({ address: token!, abi: erc20Abi, functionName: 'allowance', args: [account!, spender!] }),
  );
}

export function useFaucetClaims(account: Address | undefined, tokens: Token[]) {
  return useQuery(account ? `faucet:${account}` : null, async () => {
    const values = await Promise.all(
      tokens.map((t) =>
        client.readContract({ address: t.address, abi: faucetAbi, functionName: 'claimed', args: [account!] }),
      ),
    );
    return Object.fromEntries(tokens.map((t, i) => [t.symbol, values[i]]));
  });
}

export function useMarket(id: Hex | undefined, params: MarketParams | undefined, account?: Address) {
  return useQuery(
    deployments.morpho && id && params ? `market:${id}:${account ?? ''}` : null,
    async () => {
      const morpho = deployments.morpho!;
      const [m, oracle, position] = await Promise.all([
        client.readContract({ address: morpho, abi: morphoAbi, functionName: 'market', args: [id!] }),
        client.readContract({ address: params!.oracle, abi: oracleAbi, functionName: 'latestPrice' }),
        account
          ? client.readContract({ address: morpho, abi: morphoAbi, functionName: 'position', args: [id!, account] })
          : Promise.resolve([0n, 0n, 0n] as const),
      ]);
      const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = m;
      const rate = await client.readContract({
        address: params!.irm,
        abi: irmAbi,
        functionName: 'borrowRateView',
        args: [
          params!,
          { totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee },
        ],
      });
      const util = utilization(totalBorrowAssets, totalSupplyAssets);
      const borrowApy = rateToApy(rate);
      const [supplyShares, borrowShares, collateral] = position;
      return {
        totalSupplyAssets,
        totalSupplyShares,
        totalBorrowAssets,
        totalBorrowShares,
        liquidity: totalSupplyAssets - totalBorrowAssets,
        utilization: util,
        borrowApy,
        supplyApy: borrowApy * util * (1 - Number(fee) / 1e18),
        oraclePrice: oracle[0],
        oracleUpdatedAt: Number(oracle[1]),
        oracleFresh: oracle[2],
        supplyShares,
        borrowShares,
        collateral,
        supplied: toAssetsDown(supplyShares, totalSupplyAssets, totalSupplyShares),
        borrowed: toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares),
      };
    },
    15_000,
  );
}
