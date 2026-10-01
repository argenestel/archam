import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  type Address,
  type Hash,
} from 'viem';
import { arcTestnet, client } from './lib/arc';
import {
  deployedTokens,
  deployedRouter,
  deployedLaunchpad,
  deployment,
  faucetAbi,
  launchpadAbi,
  parseTokenAmount,
  verifyStack,
} from './lib/deployed';
import { approveExact, revokeAllowance, executeV2, quoteV2, type Quote } from './lib/protocols';
import { minimumOutput } from './lib/market';
import { userFacingError } from './lib/errors';
import PoolContext from './PoolContext';

type Props = {
  address?: string;
  chainId?: number;
  page: string;
  openWallet: () => void;
  slippageBps: number;
};
export default function LiveTerminal({ address, chainId, page, openWallet, slippageBps }: Props) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [hash, setHash] = useState<Hash>();
  const [status, setStatus] = useState('');
  const [reverse, setReverse] = useState(false);
  const [amount, setAmount] = useState('100');
  const [quote, setQuote] = useState<Quote>();
  const [quoteError, setQuoteError] = useState('');
  const [tick, setTick] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [allowance, setAllowance] = useState(0n);
  const [saleAllowance, setSaleAllowance] = useState(0n);
  const [saleAmount, setSaleAmount] = useState('100');
  const [sale, setSale] = useState<{
    raised: bigint;
    contribution: bigint;
    allocation: bigint;
    successful: boolean;
    cancelled: boolean;
    timestamp: bigint;
  }>();
  const [review, setReview] = useState(false);
  const from = deployedTokens[reverse ? 1 : 0],
    to = deployedTokens[reverse ? 0 : 1];
  const connected = !!address && chainId === arcTestnet.id;
  let input = 0n,
    contribution = 0n;
  try {
    input = parseTokenAmount(amount, from.decimals);
  } catch {
    /* invalid input disables submit */
  }
  try {
    contribution = parseTokenAmount(saleAmount, 6);
  } catch {
    /* invalid input disables submit */
  }
  const currentKey = useRef('');
  currentKey.current = `${address}:${chainId}:${from.address}`;
  const pollPaused = useRef(false);
  pollPaused.current = !!busy || review;
  const refresh = useCallback(async () => {
    const key = `${address}:${chainId}:${from.address}`;
    const block = await client.getBlock();
    const [raised, successful, cancelled] = await Promise.all([
      client.readContract({
        address: deployedLaunchpad,
        abi: launchpadAbi,
        functionName: 'totalRaised',
      }),
      client.readContract({
        address: deployedLaunchpad,
        abi: launchpadAbi,
        functionName: 'successful',
      }),
      client.readContract({
        address: deployedLaunchpad,
        abi: launchpadAbi,
        functionName: 'cancelled',
      }),
    ]);
    if (currentKey.current !== key) return;
    if (!address || chainId !== arcTestnet.id) {
      setBalances({});
      setAllowance(0n);
      setSaleAllowance(0n);
      setSale({
        raised,
        successful,
        cancelled,
        contribution: 0n,
        allocation: 0n,
        timestamp: block.timestamp,
      });
      return;
    }
    const account = address as Address;
    const [values, approval, saleApproval, supplied, allocation] = await Promise.all([
      Promise.all(
        deployedTokens.map((t) =>
          client.readContract({
            address: t.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account],
          }),
        ),
      ),
      client.readContract({
        address: from.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, deployedRouter],
      }),
      client.readContract({
        address: deployedTokens[0].address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, deployedLaunchpad],
      }),
      client.readContract({
        address: deployedLaunchpad,
        abi: launchpadAbi,
        functionName: 'contributions',
        args: [account],
      }),
      client.readContract({
        address: deployedLaunchpad,
        abi: launchpadAbi,
        functionName: 'allocations',
        args: [account],
      }),
    ]);
    if (currentKey.current !== key) return;
    setBalances(Object.fromEntries(deployedTokens.map((t, i) => [t.symbol, values[i]])));
    setAllowance(approval);
    setSaleAllowance(saleApproval);
    setSale({
      raised,
      successful,
      cancelled,
      contribution: supplied,
      allocation,
      timestamp: block.timestamp,
    });
  }, [address, chainId, from.address]);
  useEffect(() => {
    let ignore = false;
    setReady(false);
    setChecking(true);
    setError('');
    verifyStack()
      .then(() => {
        if (!ignore) setReady(true);
      })
      .catch((e) => {
        if (!ignore) setError(userFacingError(e));
      })
      .finally(() => {
        if (!ignore) setChecking(false);
      });
    return () => {
      ignore = true;
    };
  }, [checkAttempt]);
  useEffect(() => {
    if (ready || checking || busy) return;
    const retry = setTimeout(() => setCheckAttempt((n) => n + 1), 15000);
    return () => clearTimeout(retry);
  }, [ready, checking, busy]);
  useEffect(() => {
    setBalances({});
    setAllowance(0n);
    setReview(false);
    if (!ready) return;
    refresh().catch((e) => {
      setError(userFacingError(e));
      setReady(false);
    });
    const timer = setInterval(() => {
      if (pollPaused.current) return;
      setTick((t) => t + 1);
      refresh().catch((e) => {
        setError(userFacingError(e));
        setReady(false);
      });
    }, 15000);
    return () => clearInterval(timer);
  }, [ready, refresh]);
  useEffect(() => {
    let ignore = false;
    setQuote(undefined);
    setQuoteError('');
    setReview(false);
    if (!ready || !input) return;
    const timer = setTimeout(
      () =>
        quoteV2(deployedRouter, input, [from.address, to.address])
          .then((q) => {
            if (!ignore) setQuote(q);
          })
          .catch((e) => {
            if (!ignore) setQuoteError(userFacingError(e));
          }),
      350,
    );
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [ready, input, from.address, to.address, tick]);
  useEffect(() => {
    setReview(false);
  }, [slippageBps]);
  async function getWallet() {
    if (!window.ethereum || !address || !connected)
      throw new Error('Connect your wallet on Arc testnet');
    const wallet = createWalletClient({
      account: address as Address,
      chain: arcTestnet,
      transport: custom(window.ethereum),
    });
    const accounts = await wallet.getAddresses();
    if (
      accounts[0]?.toLowerCase() !== address.toLowerCase() ||
      (await wallet.getChainId()) !== arcTestnet.id
    )
      throw new Error('Wallet changed; reconnect and review');
    await verifyStack();
    return wallet;
  }
  async function action(label: string, fn: () => Promise<Hash | null>) {
    if (busy) return;
    setBusy(label);
    setError('');
    setStatus('Waiting for wallet confirmation…');
    setHash(undefined);
    setReview(false);
    try {
      const txHash = await fn();
      if (txHash) {
        setHash(txHash);
        setStatus('Submitted. Waiting for confirmation…');
        const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 120000 });
        if (receipt.status !== 'success') throw new Error('Transaction reverted');
      }
      setStatus(`${label} confirmed on Arc testnet.`);
      await refresh();
      setTick((t) => t + 1);
    } catch (e) {
      setError(
        userFacingError(e, 'Could not complete the request. Check your wallet and try again.'),
      );
      setStatus('');
    } finally {
      setBusy('');
    }
  }
  async function contractAction(
    kind: 'faucet' | 'contribute' | 'claim' | 'refund',
    token = deployedTokens[0],
  ): Promise<Hash> {
    const wallet = await getWallet();
    if (kind === 'faucet') {
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: token.address,
        abi: faucetAbi,
        functionName: 'faucet',
      });
      return wallet.writeContract({ ...request, chain: arcTestnet });
    }
    if (kind === 'contribute') {
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: deployedLaunchpad,
        abi: launchpadAbi,
        functionName: 'contribute',
        args: [contribution],
      });
      return wallet.writeContract({ ...request, chain: arcTestnet });
    }
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: deployedLaunchpad,
      abi: launchpadAbi,
      functionName: kind,
    });
    return wallet.writeContract({ ...request, chain: arcTestnet });
  }
  const start = BigInt(deployment.sale.start),
    end = BigInt(deployment.sale.end);
  const saleOpen = !!sale && !sale.cancelled && sale.timestamp >= start && sale.timestamp < end;
  const failed = !!sale && (sale.cancelled || (sale.timestamp >= end && !sale.successful));
  const validSwap =
    ready &&
    connected &&
    input > 0n &&
    input <= (balances[from.symbol] || 0n) &&
    !!quote &&
    quote.amountIn === input &&
    quote.path[0] === from.address &&
    quote.path[quote.path.length - 1] === to.address &&
    !busy;
  const explorer = `${arcTestnet.blockExplorers.default.url}/tx/`;
  return (
    <section className="live-terminal">
      <div className="section-top terminal-heading">
        <div>
          <h2>{page === 'Discover' ? 'Orbit testnet launchpad' : 'Arc spot market'}</h2>
          <p className="subtle">Onchain quotes. Wallet-confirmed transactions.</p>
        </div>
        <span className="badge-green">
          <ShieldCheck size={14} />
          {ready ? 'Arc connected' : checking ? 'Connecting to Arc…' : 'Connection interrupted'}
        </span>
      </div>
      <details className="testnet-disclosure">
        <summary>
          <ShieldCheck size={16} />
          Testnet assets, not real USDC or ETH<span>Read risks</span>
        </summary>
        <p>
          tUSDC and tETH are freely minted test assets with no value. Native testnet USDC pays gas.
          This deployment is experimental and unaudited. Never send real-value assets.
        </p>
      </details>
      {!ready && (
        <div className="connection-recovery" role="status">
          <div>
            <strong>{checking ? 'Finding a route to Arc' : 'We can’t reach Arc right now'}</strong>
            <p>
              {checking
                ? 'Checking the network and deployed contracts.'
                : 'Trading is paused. Check your connection and try again.'}
            </p>
          </div>
          <button
            className="secondary"
            disabled={checking}
            onClick={() => setCheckAttempt((n) => n + 1)}
          >
            <RefreshCw size={15} />
            {checking ? 'Connecting…' : 'Retry connection'}
          </button>
        </div>
      )}
      <div className="live-layout">
        <div className="live-workspace">
          {!connected && (
            <button className="primary full" onClick={openWallet}>
              {address ? 'Switch wallet to Arc testnet' : 'Connect wallet to transact'}
            </button>
          )}
          <div className="live-faucets">
            <div className="faucet-heading">
              <h3>Start with test tokens</h3>
              <span>Free, once per wallet</span>
            </div>
            {deployedTokens.map((t) => (
              <div key={t.symbol}>
                <div>
                  <strong>{t.symbol}</strong>
                  <span>{formatUnits(balances[t.symbol] || 0n, t.decimals)} available</span>
                </div>
                <button
                  className="secondary"
                  disabled={!ready || !connected || !!busy}
                  onClick={() => action(`Claim ${t.symbol}`, () => contractAction('faucet', t))}
                >
                  Claim test {t.symbol}
                </button>
              </div>
            ))}
          </div>
          {page === 'Trade' && (
            <div className="live-trade-content">
              <div className="live-form-title">
                <h3>Swap</h3>
                <span>Uniswap V2</span>
              </div>
              <div className="token-field">
                <div className="field-label">
                  <label htmlFor="live-amount">You pay · {from.symbol}</label>
                  <button
                    disabled={!connected || !!busy}
                    onClick={() =>
                      setAmount(formatUnits(balances[from.symbol] || 0n, from.decimals))
                    }
                  >
                    MAX
                  </button>
                </div>
                <div className="amount-row">
                  <input
                    id="live-amount"
                    inputMode="decimal"
                    value={amount}
                    disabled={!!busy}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span className="token-select">
                    <span className={`live-coin ${from.symbol === 'tUSDC' ? 'usdc' : 'eth'}`}>
                      {from.symbol === 'tUSDC' ? '$' : '♦'}
                    </span>
                    {from.symbol}
                  </span>
                </div>
              </div>
              <div className="live-reverse">
                <button
                  className="icon-button"
                  aria-label="Reverse live pair"
                  disabled={!!busy}
                  onClick={() => {
                    setReverse(!reverse);
                    setAmount('');
                  }}
                >
                  <ArrowDown size={19} />
                </button>
              </div>
              <div className="token-field">
                <div className="field-label">Estimated receive · onchain quote</div>
                <div className="amount-row">
                  <output title={quote ? formatUnits(quote.amountOut, to.decimals) : undefined}>
                    {quote
                      ? formatUnits(quote.amountOut, to.decimals).replace(/(\.\d{8})\d+$/, '$1')
                      : '—'}
                  </output>
                  <span className="token-select">
                    <span className={`live-coin ${to.symbol === 'tUSDC' ? 'usdc' : 'eth'}`}>
                      {to.symbol === 'tUSDC' ? '$' : '♦'}
                    </span>
                    {to.symbol}
                  </span>
                </div>
              </div>
              <div className="detail-row">
                <span>Minimum received · {slippageBps / 100}% slippage</span>
                <strong>
                  {quote
                    ? formatUnits(minimumOutput(quote.amountOut, slippageBps), to.decimals)
                    : '—'}{' '}
                  {to.symbol}
                </strong>
              </div>
              <div className="detail-row">
                <span>Route</span>
                <strong>Uniswap V2 · 0.30% LP fee</strong>
              </div>
              {quoteError && <p className="error">{quoteError}</p>}
              {input > (balances[from.symbol] || 0n) && connected && (
                <p className="subtle">Insufficient {from.symbol}. Claim faucet tokens above.</p>
              )}
              <div className="button-row live-buttons">
                <button
                  className="secondary"
                  disabled={!validSwap || allowance >= input}
                  onClick={() =>
                    action(`Approve ${from.symbol}`, async () =>
                      approveExact(await getWallet(), from.address, deployedRouter, input),
                    )
                  }
                >
                  {allowance >= input && input > 0n ? <Check size={15} /> : null}
                  {allowance >= input && input > 0n
                    ? 'Allowance ready'
                    : `Approve exact ${from.symbol}`}
                </button>
                <button
                  className="primary"
                  disabled={!validSwap || allowance < input}
                  onClick={() => setReview(true)}
                >
                  Review live swap <ArrowRight size={15} />
                </button>
              </div>
              {allowance > 0n && (
                <button
                  className="text-button full"
                  disabled={!!busy || !connected}
                  onClick={() =>
                    action('Reset router allowance', async () =>
                      revokeAllowance(await getWallet(), from.address, deployedRouter),
                    )
                  }
                >
                  Reset router allowance to zero
                </button>
              )}
              {review && quote && (
                <div className="live-review">
                  <h3>Confirm testnet swap</h3>
                  <p>
                    {formatUnits(input, from.decimals)} {from.symbol} → at least{' '}
                    {formatUnits(minimumOutput(quote.amountOut, slippageBps), to.decimals)}{' '}
                    {to.symbol}
                  </p>
                  <p>
                    Recipient: {address?.slice(0, 10)}…{address?.slice(-8)} · Chain 5042002. Your
                    wallet will show gas before signing. No XP is awarded for live test trades.
                  </p>
                  <button
                    className="primary full"
                    disabled={!validSwap || allowance < input}
                    onClick={() =>
                      action(
                        'Swap',
                        async () =>
                          (await executeV2(await getWallet(), quote, slippageBps)).transactionHash,
                      )
                    }
                  >
                    Confirm swap on Arc testnet
                  </button>
                </div>
              )}
            </div>
          )}
          {page === 'Discover' && (
            <div className="live-sale">
              <div className="detail-row">
                <span>Sale status</span>
                <strong>
                  {!sale
                    ? 'Loading…'
                    : sale.cancelled
                      ? 'Cancelled'
                      : sale.timestamp < start
                        ? 'Starts shortly'
                        : sale.timestamp < end
                          ? 'Open'
                          : sale.successful
                            ? 'Succeeded · claims open'
                            : 'Failed · refunds open'}
                </strong>
              </div>
              <div className="detail-row">
                <span>Closes</span>
                <strong>{new Date(Number(end) * 1000).toLocaleString()}</strong>
              </div>
              <div className="detail-row">
                <span>Raised / hard cap</span>
                <strong>{sale ? formatUnits(sale.raised, 6) : '—'} / 200,000 tUSDC</strong>
              </div>
              <div className="detail-row">
                <span>Soft cap / rate</span>
                <strong>1,000 tUSDC · 2 tORBIT per tUSDC</strong>
              </div>
              <div className="detail-row">
                <span>Your contribution / allocation</span>
                <strong>
                  {sale ? formatUnits(sale.contribution, 6) : '—'} tUSDC /{' '}
                  {sale ? formatUnits(sale.allocation, 18) : '—'} tORBIT
                </strong>
              </div>
              <label className="action-input-label" htmlFor="live-sale-amount">
                Contribution in test tUSDC
              </label>
              <div className="action-input">
                <input
                  id="live-sale-amount"
                  inputMode="decimal"
                  value={saleAmount}
                  disabled={!!busy}
                  onChange={(e) => setSaleAmount(e.target.value)}
                />
              </div>
              <div className="button-row live-buttons">
                <button
                  className="secondary"
                  disabled={
                    !ready ||
                    !connected ||
                    !!busy ||
                    !saleOpen ||
                    contribution <= 0n ||
                    contribution > (balances.tUSDC || 0n) ||
                    saleAllowance >= contribution
                  }
                  onClick={() =>
                    action('Approve sale payment', async () =>
                      approveExact(
                        await getWallet(),
                        deployedTokens[0].address,
                        deployedLaunchpad,
                        contribution,
                      ),
                    )
                  }
                >
                  Approve exact payment
                </button>
                <button
                  className="primary"
                  disabled={
                    !ready ||
                    !connected ||
                    !!busy ||
                    !saleOpen ||
                    contribution <= 0n ||
                    contribution > (balances.tUSDC || 0n) ||
                    saleAllowance < contribution
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Contribute ${formatUnits(contribution, 6)} valueless tUSDC to the experimental sale? Funds are escrowed until settlement or cancellation.`,
                      )
                    )
                      action('Contribute', () => contractAction('contribute'));
                  }}
                >
                  Contribute test tokens
                </button>
              </div>
              <div className="button-row live-buttons">
                <button
                  className="secondary"
                  disabled={
                    !ready || !connected || !!busy || !sale?.successful || sale.allocation === 0n
                  }
                  onClick={() => action('Claim sale tokens', () => contractAction('claim'))}
                >
                  Claim tORBIT
                </button>
                <button
                  className="secondary"
                  disabled={!ready || !connected || !!busy || !failed || !sale?.contribution}
                  onClick={() => action('Refund', () => contractAction('refund'))}
                >
                  Refund failed sale
                </button>
              </div>
              {saleAllowance > 0n && (
                <button
                  className="text-button full"
                  disabled={!!busy || !connected}
                  onClick={() =>
                    action('Reset sale allowance', async () =>
                      revokeAllowance(
                        await getWallet(),
                        deployedTokens[0].address,
                        deployedLaunchpad,
                      ),
                    )
                  }
                >
                  Reset sale allowance to zero
                </button>
              )}
              <p className="subtle">
                Owner can cancel before sale end, enabling refunds. Token allocations become
                claimable only after a successful raise ends. No liquidity-pool creation or vesting.
              </p>
            </div>
          )}
          {busy && (
            <p className="live-status" role="status">
              <RefreshCw size={15} />
              {busy} · {status}
            </p>
          )}
          {!busy && status && (
            <p className="live-status" role="status">
              <Check size={15} />
              {status}
            </p>
          )}
          {hash && (
            <a className="text-button" href={`${explorer}${hash}`} target="_blank" rel="noreferrer">
              View transaction <ExternalLink size={14} />
            </a>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="live-contract-links">
            <a
              href={`${arcTestnet.blockExplorers.default.url}/address/${deployedRouter}`}
              target="_blank"
              rel="noreferrer"
            >
              Router <ExternalLink size={12} />
            </a>
            <a
              href={`${arcTestnet.blockExplorers.default.url}/address/${deployedLaunchpad}`}
              target="_blank"
              rel="noreferrer"
            >
              Launchpad <ExternalLink size={12} />
            </a>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => {
                if (!ready) setCheckAttempt((n) => n + 1);
                else
                  refresh().catch((e) => {
                    setError(userFacingError(e));
                    setReady(false);
                  });
                setTick((t) => t + 1);
              }}
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </div>
        <PoolContext connected={ready} />
      </div>
    </section>
  );
}
