// The app modules choose their network when first loaded, so the policy's network must be set
// first, and they must be imported dynamically (static imports are hoisted above this code).
const { loadPolicy } = await import('./policy.mjs');
process.env.VITE_ARC_NETWORK = loadPolicy().network;

import { formatUnits, parseUnits, erc20Abi } from 'viem';
const { quoteAll } = await import('../src/lib/adapters/index.ts');
const { tokenBySymbol } = await import('../src/lib/contracts.ts');
const { networkName } = await import('../src/lib/arc.ts');
if (networkName !== loadPolicy().network) throw new Error(`Router loaded ${networkName} but policy is ${loadPolicy().network}`);

const json = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

/**
 * Resolve a token symbol or address to a Token object.
 * Falls back to baseTokens; launch tokens can be added by extending the list.
 */
function resolveToken(symbolOrAddr) {
  if (typeof symbolOrAddr !== 'string') throw new Error('Token must be a string (symbol or address)');
  const fromBase = tokenBySymbol(symbolOrAddr);
  if (fromBase) return fromBase;
  // Unknown addresses are refused: guessing decimals could mis-size a trade by orders of magnitude.
  throw new Error(`Token not found: ${symbolOrAddr}`);
}

/**
 * Quote the best available swap across all venues (smart router).
 * Returns JSON-safe quotes, excluding 'sdk' kind venues (agent has Circle swap via App Kit).
 *
 * @param ctx - Fund manager context with { policy, account, ... }
 * @param {Object} params
 * @param {string} params.tokenIn - Token symbol or address
 * @param {string} params.tokenOut - Token symbol or address
 * @param {string|number} params.amountIn - Amount as string (decimal) or number
 * @returns {Promise<Array>} Array of JSON-safe swap quotes, ranked by best output
 */
export async function bestSwapQuotes(ctx, { tokenIn: tokenInSymbol, tokenOut: tokenOutSymbol, amountIn }) {
  const tokenIn = resolveToken(tokenInSymbol);
  const tokenOut = resolveToken(tokenOutSymbol);

  const amount = typeof amountIn === 'string' ? parseUnits(amountIn, tokenIn.decimals) : BigInt(amountIn);

  const slippageBps = Math.min(50, ctx.policy.maxSlippageBps ?? 50);
  const quotes = await quoteAll({
    tokenIn,
    tokenOut,
    amountIn: amount,
    slippageBps,
    account: ctx.account?.address,
  });

  // Filter out 'sdk' kind venues and return JSON-safe quotes
  return json(
    quotes
      .filter((q) => {
        const exec = q.execution(ctx.account?.address);
        return exec.kind !== 'sdk';
      })
      .map((q) => ({
        venue: q.venue,
        via: q.via,
        amountIn: q.amountIn.toString(),
        amountOut: q.amountOut.toString(),
        minOut: q.minOut.toString(),
        fee: q.fee,
      })),
  );
}

/**
 * Execute the best (or named) contract-kind swap via the policy-gated guarded() runner.
 * Simulates all steps, then executes sequentially: prep steps → approval → main swap.
 * Stops on any revert.
 *
 * @param ctx - Fund manager context
 * @param {Object} params
 * @param {string} params.tokenIn - Token symbol or address
 * @param {string} params.tokenOut - Token symbol or address
 * @param {string|number} params.amountIn - Amount as string or number
 * @param {string} [params.venue] - Optional: pick a specific venue (else best)
 * @param {boolean} [params.confirm=false] - If true and policy.dryRun=false, broadcast the transaction
 * @param {string} [params.reason] - One-sentence reason, recorded in audit log
 * @returns {Promise<Object>} Execution result { action, status, result/error, ... }
 */
export async function swapBest(ctx, { tokenIn: tokenInSymbol, tokenOut: tokenOutSymbol, amountIn, venue, confirm, reason }) {
  const { guarded, marketData } = await import('./core.mjs');
  const tokenIn = resolveToken(tokenInSymbol);
  const tokenOut = resolveToken(tokenOutSymbol);

  const amount = typeof amountIn === 'string' ? parseUnits(amountIn, tokenIn.decimals) : BigInt(amountIn);

  // Quote the best swaps
  const quotes = await quoteAll({
    tokenIn,
    tokenOut,
    amountIn: amount,
    slippageBps: Math.min(50, ctx.policy.maxSlippageBps ?? 50),
    account: ctx.account?.address,
  });

  // Pick the named venue or the best contract-kind quote
  let quote = venue ? quotes.find((q) => q.venue === venue) : undefined;
  if (!quote) {
    quote = quotes.find((q) => {
      const exec = q.execution(ctx.account?.address);
      return exec.kind === 'contract';
    });
  }

  if (!quote) throw new Error(`No ${venue ? `venue ${venue}` : 'contract-kind'} quote available.`);

  // Calculate USD notional
  let usd;
  if (tokenIn.symbol === 'USDC' || tokenIn.symbol === 'tUSDC') {
    usd = Number(formatUnits(amount, tokenIn.decimals));
  } else {
    // Try to fetch price via marketData; otherwise refuse
    const md = await marketData(ctx);
    const price = md.tokenPricesUsd?.[tokenIn.symbol];
    if (!price) throw new Error(`No USD price for ${tokenIn.symbol}; cannot authorize swap.`);
    usd = Number(formatUnits(amount, tokenIn.decimals)) * price;
  }

  const slippageBps = Math.min(50, ctx.policy.maxSlippageBps ?? 50);

  // Build the execution plan
  const execution = quote.execution(ctx.account?.address);
  if (execution.kind !== 'contract') throw new Error('Only contract-kind quotes are supported.');

  const runSwap = async () => {
    const { wallet, pub, chain } = ctx;
    if (!wallet) throw new Error('No wallet configured.');

    // Run each prep step
    if (execution.prep) {
      for (const step of execution.prep) {
        if (!(await step.needed())) continue;
        const simResult = await pub.simulateContract({
          address: step.request.address,
          abi: step.request.abi,
          functionName: step.request.functionName,
          args: step.request.args,
          account: ctx.account,
        });
        if (simResult.request) {
          const hash = await wallet.sendTransaction(simResult.request);
          await pub.waitForTransactionReceipt({ hash });
        }
      }
    }

    // Handle approval if needed
    if (execution.approve) {
      const { token, spender, amount: approvalAmount } = execution.approve;
      const allowance = await pub.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ctx.account.address, spender],
      });

      if (allowance < approvalAmount) {
        const simApprove = await pub.simulateContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, approvalAmount],
          account: ctx.account,
        });
        if (simApprove.request) {
          const hash = await wallet.sendTransaction(simApprove.request);
          await pub.waitForTransactionReceipt({ hash });
        }
      }
    }

    // Execute the main swap
    const simMain = await pub.simulateContract({
      address: execution.request.address,
      abi: execution.request.abi,
      functionName: execution.request.functionName,
      args: execution.request.args,
      account: ctx.account,
    });
    if (simMain.request) {
      const hash = await wallet.sendTransaction(simMain.request);
      await pub.waitForTransactionReceipt({ hash });
      return { hash, amountOut: quote.amountOut.toString() };
    }
  };

  return guarded(
    ctx,
    {
      action: 'swap',
      token: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      usd,
      slippageBps,
      venue: quote.venue,
    },
    runSwap,
    { confirm, reason },
  );
}
