import { erc20Abi, parseAbi, type Address, type WalletClient } from 'viem';
import { arcTestnet, client, verifyDeployment } from './arc';
import { minimumOutput } from './market';

// Canonical Uniswap V2 Router02 and Aave V3 Pool ABIs, not new AMM/lending code.
// https://github.com/Uniswap/v2-periphery/blob/master/contracts/interfaces/IUniswapV2Router01.sol
// https://github.com/aave/aave-v3-core/blob/master/contracts/interfaces/IPool.sol
export const routerAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
]);
export const lendingAbi = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
]);

export async function quoteV2(router: Address, amount: bigint, path: Address[]) {
  if (
    amount <= 0n ||
    path.length < 2 ||
    path[0].toLowerCase() === path[path.length - 1].toLowerCase()
  )
    throw new Error('Invalid swap');
  await verifyDeployment(router);
  const amounts = await client.readContract({
    address: router,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [amount, path],
  });
  const out = amounts[amounts.length - 1];
  if (!out) throw new Error('No liquidity for this route');
  return {
    amountIn: amount,
    amountOut: out,
    path: [...path],
    router,
    quotedAt: Date.now(),
    chainId: arcTestnet.id,
  };
}
export type Quote = Awaited<ReturnType<typeof quoteV2>>;
async function signer(wallet: WalletClient) {
  const account = wallet.account;
  if (!account) throw new Error('Connect a wallet first');
  if ((await wallet.getChainId()) !== arcTestnet.id) throw new Error('Switch to Arc testnet');
  if (account.type === 'json-rpc') {
    const accounts = await wallet.getAddresses();
    if (accounts[0]?.toLowerCase() !== account.address.toLowerCase())
      throw new Error('Active wallet account changed; reconnect and review');
  }
  return account;
}
// Explicit approval step: exact amount only; never called automatically by the UI.
// USDT-style nonzero allowance must first be reset in a separate user-approved tx.
export async function approveExact(
  wallet: WalletClient,
  token: Address,
  spender: Address,
  amount: bigint,
) {
  const account = await signer(wallet);
  if (amount <= 0n) throw new Error('Amount must be positive');
  await verifyDeployment(token);
  await verifyDeployment(spender);
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  });
  if (allowance >= amount) return null;
  if (allowance > 0n)
    throw new Error(
      'Reset existing allowance to zero in your wallet before approving a new exact amount',
    );
  const { request } = await client.simulateContract({
    account,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  });
  const hash = await wallet.writeContract({ ...request, chain: arcTestnet });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Approval reverted');
  return hash;
}
export async function revokeAllowance(wallet: WalletClient, token: Address, spender: Address) {
  const account = await signer(wallet);
  await verifyDeployment(token);
  await verifyDeployment(spender);
  const { request } = await client.simulateContract({
    account,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, 0n],
  });
  await signer(wallet);
  return wallet.writeContract({ ...request, chain: arcTestnet });
}
export async function executeV2(wallet: WalletClient, quote: Quote, slippageBps: number) {
  const account = await signer(wallet);
  if (
    quote.chainId !== arcTestnet.id ||
    Date.now() - quote.quotedAt > 30000 ||
    quote.quotedAt > Date.now()
  )
    throw new Error('Quote expired; request and review a new quote');
  await verifyDeployment(quote.router);
  const min = minimumOutput(quote.amountOut, slippageBps);
  if (min <= 0n) throw new Error('Minimum output rounds to zero');
  const latest = await quoteV2(quote.router, quote.amountIn, quote.path);
  if (latest.amountOut < min)
    throw new Error('Price moved beyond your tolerance; review a new quote');
  const block = await client.getBlock();
  const { request } = await client.simulateContract({
    account,
    address: quote.router,
    abi: routerAbi,
    functionName: 'swapExactTokensForTokens',
    args: [quote.amountIn, min, quote.path, account.address, block.timestamp + 300n],
  });
  const hash = await wallet.writeContract({ ...request, chain: arcTestnet });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Swap reverted');
  return receipt;
}
export async function supplyAave(
  wallet: WalletClient,
  pool: Address,
  asset: Address,
  amount: bigint,
) {
  const account = await signer(wallet);
  if (amount <= 0n) throw new Error('Amount must be positive');
  await verifyDeployment(pool);
  await verifyDeployment(asset);
  const { request } = await client.simulateContract({
    account,
    address: pool,
    abi: lendingAbi,
    functionName: 'supply',
    args: [asset, amount, account.address, 0],
  });
  const hash = await wallet.writeContract({ ...request, chain: arcTestnet });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Supply reverted');
  return receipt;
}
