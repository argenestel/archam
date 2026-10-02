import { parseAbi, type Address, type Hex } from 'viem';
import testnet from '../../deployments/arc-testnet.json';
import { circle, networkName } from './arc';

export type Token = {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  kind: 'circle' | 'test' | 'launch';
};
export type MarketParams = {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

/**
 * Deployment registry. Only addresses recorded in a committed manifest are used; there is
 * no runtime override. Mainnet has no Orbit deployment yet, so mainnet builds disable
 * every Orbit-operated feature instead of pointing at testnet contracts.
 */
const m = networkName === 'testnet' ? testnet : undefined;
const at = (name: keyof typeof testnet.contracts) => m?.contracts[name]?.address as Address | undefined;

export const deployments = {
  router: at('UniswapV2Router02'),
  factory: at('UniswapV2Factory'),
  launch: m?.launch?.contract as Address | undefined,
  
  morpho: m?.lending?.morpho as Address | undefined,
  oracle: at('OrbitTestnetOracle'),
};
export const lendingMarkets = (m?.lending?.markets ?? []).map((market) => ({
  id: market.id as Hex,
  label: market.label,
  params: {
    loanToken: market.loanToken as Address,
    collateralToken: market.collateralToken as Address,
    oracle: market.oracle as Address,
    irm: market.irm as Address,
    lltv: BigInt(market.lltv),
  } satisfies MarketParams,
}));
export const launchConfig = {
  feeBps: BigInt(m?.launch?.feeBps ?? 100),
  virtualQuote: BigInt(m?.launch?.virtualQuote ?? 0),
  saleSupply: 793_100_000n * 10n ** 18n,
  virtualToken: 1_073_000_000n * 10n ** 18n,
  totalSupply: 1_000_000_000n * 10n ** 18n,
};
/** Quote raised (net of fees) when the curve sells out: V0 * S / (T0 - S). */
export const graduationQuote =
  (launchConfig.virtualQuote * launchConfig.saleSupply) /
  (launchConfig.virtualToken - launchConfig.saleSupply);

export const USDC: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: circle.usdc,
  decimals: 6,
  kind: 'circle',
};
export const baseTokens: Token[] = [
  USDC,
  ...(m
    ? ([
        {
          symbol: 'tUSDC',
          name: 'Orbit test dollar',
          address: m.contracts.TestUSDC.address as Address,
          decimals: 6,
          kind: 'test',
        },
        {
          symbol: 'tETH',
          name: 'Orbit test ether',
          address: m.contracts.TestETH.address as Address,
          decimals: 18,
          kind: 'test',
        },
      ] satisfies Token[])
    : []),
];
export const faucetTokens = baseTokens.filter((t) => t.kind === 'test');
export const tokenBySymbol = (s: string) => baseTokens.find((t) => t.symbol === s);

export const launchAbi = parseAbi([
  'struct Trade { address token; address trader; uint40 time; bool isBuy; uint128 quoteAmount; uint128 tokenAmount; }',
  'struct Position { uint128 spent; uint128 received; uint128 bought; uint128 sold; }',
  'struct TraderStats { uint128 volume; uint128 spent; uint128 received; uint32 trades; uint32 launches; uint40 firstTradeAt; }',
  'function launch(string name, string symbol, string image, string description, uint256 initialBuy, uint256 minTokensOut) returns (address)',
  'function buy(address token, uint256 quoteIn, uint256 minTokensOut, uint256 deadline) returns (uint256)',
  'function sell(address token, uint256 tokensIn, uint256 minQuoteOut, uint256 deadline) returns (uint256)',
  'function quoteBuy(address token, uint256 quoteIn) view returns (uint256 tokensOut, uint256 charged)',
  'function quoteSell(address token, uint256 tokensIn) view returns (uint256)',
  'function curves(address) view returns (address creator, uint40 createdAt, uint40 lastTradeAt, bool graduated, uint256 virtualQuote, uint256 virtualToken, uint256 realQuote, uint256 tokensLeft, uint256 volume, uint32 trades, address pair, string image, string description)',
  'function tokenCount() view returns (uint256)',
  'function tradeCount() view returns (uint256)',
  'function traderCount() view returns (uint256)',
  'function tokensPage(uint256 offset, uint256 limit) view returns (address[])',
  'function tradesPage(address token, uint256 offset, uint256 limit) view returns (Trade[] page, uint256[] ids)',
  'function tradersPage(uint256 offset, uint256 limit) view returns (address[] accounts, TraderStats[] values)',
  'function positionsOf(address trader) view returns (address[] held, Position[] values, uint256[] balances)',
  'function stats(address) view returns (uint128 volume, uint128 spent, uint128 received, uint32 trades, uint32 launches, uint40 firstTradeAt)',
  'event Launched(address indexed token, address indexed creator, string name, string symbol)',
]);
export const morphoAbi = parseAbi([
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function supply(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
  'function withdraw(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
  'function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)',
  'function withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)',
]);
export const irmAbi = parseAbi([
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }',
  'function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)',
]);
export const oracleAbi = parseAbi([
  'function latestPrice() view returns (uint256 value, uint256 timestamp, bool fresh)',
  'function description() view returns (string)',
]);
export const routerAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
]);
export const factoryAbi = parseAbi(['function getPair(address, address) view returns (address)']);
export const pairAbi = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
]);
export const faucetAbi = parseAbi([
  'function faucet()',
  'function claimed(address) view returns (bool)',
]);

/** Runtime bytecode hashes from the committed manifest, keyed by lowercase address. */
export const codeHashes = new Map<string, string>(
  Object.values(m?.contracts ?? {}).map((c) => [c.address.toLowerCase(), c.runtimeCodeHash]),
);
