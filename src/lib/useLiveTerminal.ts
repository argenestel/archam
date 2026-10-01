import { useCallback, useEffect, useRef, useState } from 'react';
import { createWalletClient, custom, erc20Abi, type Address, type Hash } from 'viem';
import { arcTestnet, client } from './arc';
import {
  deployedTokens,
  deployedRouter,
  deployedLaunchpad,
  deployment,
  faucetAbi,
  launchpadAbi,
  parseTokenAmount,
  verifyStack,
} from './deployed';
import { approveExact, executeV2, quoteV2, revokeAllowance, type Quote } from './protocols';
import { userFacingError } from './errors';
import { readTransactions, saveTransaction } from './transactions';
export type TransactionPhase = 'idle' | 'signing' | 'pending' | 'success' | 'error' | 'unknown';
export function useLiveTerminal(
  address?: string,
  chainId?: number,
  page = 'Trade',
  slippageBps = 50,
) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [phase, setPhase] = useState<TransactionPhase>('idle');
  const [hash, setHash] = useState<Hash>();
  const [reverse, setReverse] = useState(false);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote>();
  const [quoteError, setQuoteError] = useState('');
  const [tick, setTick] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [allowance, setAllowance] = useState(0n);
  const [saleAllowance, setSaleAllowance] = useState(0n);
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [saleAmount, setSaleAmount] = useState('');
  const [sale, setSale] = useState<{
    raised: bigint;
    contribution: bigint;
    allocation: bigint;
    successful: boolean;
    cancelled: boolean;
    timestamp: bigint;
  }>();
  const [review, setReview] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const from = deployedTokens[reverse ? 1 : 0],
    to = deployedTokens[reverse ? 0 : 1];
  const connected = !!address && chainId === arcTestnet.id;
  const currentKey = useRef('');
  currentKey.current = `${address}:${chainId}:${from.address}:${page}`;
  const paused = useRef(false);
  paused.current = !!busy || review;
  const submission = useRef<
    { hash: Hash; label: string; account: string; time: number } | undefined
  >(undefined);
  useEffect(() => {
    if (!address || chainId !== arcTestnet.id) return;
    const unresolved = readTransactions().find(
      (tx) =>
        tx.account.toLowerCase() === address.toLowerCase() &&
        (tx.status === 'pending' || tx.status === 'unknown'),
    );
    if (unresolved) {
      submission.current = unresolved;
      setHash(unresolved.hash);
      setPhase('unknown');
      setError(
        'A previous transaction needs confirmation. Check its status before sending another.',
      );
    }
  }, [address, chainId]);
  let input = 0n,
    contribution = 0n;
  try {
    input = parseTokenAmount(amount, from.decimals);
  } catch {
    /* Invalid amounts never reach calldata. */
  }
  try {
    contribution = parseTokenAmount(saleAmount, 6);
  } catch {
    /* Invalid amounts never reach calldata. */
  }
  const refresh = useCallback(async () => {
    const key = `${address}:${chainId}:${from.address}:${page}`;
    let saleState: typeof sale;
    if (page === 'Discover') {
      const [block, raised, successful, cancelled] = await Promise.all([
        client.getBlock(),
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
      saleState = {
        raised,
        successful,
        cancelled,
        contribution: 0n,
        allocation: 0n,
        timestamp: block.timestamp,
      };
    }
    if (currentKey.current !== key) return;
    if (!connected || !address) {
      setBalances({});
      setAllowance(0n);
      setSaleAllowance(0n);
      setClaimed({});
      if (saleState) setSale(saleState);
      return;
    }
    const account = address as Address;
    const [values, approvals, faucets] = await Promise.all([
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
      Promise.all([
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
      ]),
      Promise.all(
        deployedTokens.map((t) =>
          client.readContract({
            address: t.address,
            abi: faucetAbi,
            functionName: 'claimed',
            args: [account],
          }),
        ),
      ),
    ]);
    if (saleState) {
      const [payment, allocation] = await Promise.all([
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
      saleState.contribution = payment;
      saleState.allocation = allocation;
    }
    if (currentKey.current !== key) return;
    setBalances(Object.fromEntries(deployedTokens.map((t, i) => [t.symbol, values[i]])));
    setClaimed(Object.fromEntries(deployedTokens.map((t, i) => [t.symbol, faucets[i]])));
    setAllowance(approvals[0]);
    setSaleAllowance(approvals[1]);
    if (saleState) setSale(saleState);
  }, [address, chainId, connected, from.address, page]);
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
  }, [attempt]);
  useEffect(() => {
    if (ready || checking || busy || phase === 'unknown') return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), 15000);
    return () => clearTimeout(timer);
  }, [ready, checking, busy, phase]);
  useEffect(() => {
    setBalances({});
    setAllowance(0n);
    setReview(false);
    setClaimed({});
    if (!ready) return;
    const load = () =>
      refresh().catch((e) => {
        setError(userFacingError(e));
        setReady(false);
      });
    load();
    const timer = setInterval(() => {
      if (!paused.current) {
        load();
        setTick((n) => n + 1);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [ready, refresh]);
  useEffect(() => {
    let ignore = false;
    setQuote(undefined);
    setQuoteError('');
    setReview(false);
    if (!ready || !input || page !== 'Trade') return;
    const timer = setTimeout(
      () =>
        quoteV2(deployedRouter, input, [from.address, to.address])
          .then((q) => {
            if (!ignore) setQuote(q);
          })
          .catch((e) => {
            if (!ignore) setQuoteError(userFacingError(e));
          }),
      300,
    );
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [ready, input, from.address, to.address, tick, page]);
  useEffect(() => {
    setReview(false);
  }, [slippageBps]);
  useEffect(() => {
    if (!review) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review]);
  async function getWallet() {
    if (!window.ethereum || !connected || !address)
      throw new Error('Connect your wallet on Arc testnet.');
    const wallet = createWalletClient({
      account: address as Address,
      chain: arcTestnet,
      transport: custom(window.ethereum),
    });
    if (
      (await wallet.getAddresses())[0]?.toLowerCase() !== address.toLowerCase() ||
      (await wallet.getChainId()) !== arcTestnet.id
    )
      throw new Error('Wallet changed. Reconnect and review your transaction.');
    await verifyStack();
    return wallet;
  }
  function recordSubmitted(txHash: Hash, label: string) {
    submission.current = { hash: txHash, label, account: address!, time: Date.now() };
    setHash(txHash);
    setPhase('pending');
    saveTransaction({ ...submission.current, chainId: arcTestnet.id, status: 'pending' });
  }
  function recordOutcome(status: 'confirmed' | 'reverted' | 'unknown') {
    if (submission.current)
      saveTransaction({ ...submission.current, chainId: arcTestnet.id, status });
  }
  async function action(
    label: string,
    fn: (onSubmitted: (hash: Hash) => void) => Promise<Hash | null>,
  ) {
    if (busy || phase === 'unknown') return;
    setBusy(label);
    setPhase('signing');
    setError('');
    setHash(undefined);
    setReview(false);
    submission.current = undefined;
    try {
      const txHash = await fn((h) => recordSubmitted(h, label));
      if (txHash) {
        if (!submission.current) recordSubmitted(txHash, label);
        const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 90000 });
        if (receipt.status !== 'success') {
          recordOutcome('reverted');
          throw new Error('Transaction reverted.');
        }
        recordOutcome('confirmed');
      }
      setPhase('success');
      // A failed balance refresh must not turn a confirmed transaction into an unknown one.
      refresh().catch((e) => {
        setError(userFacingError(e));
        setReady(false);
      });
      setTick((n) => n + 1);
    } catch (e) {
      if (submission.current && e instanceof Error && /reverted/i.test(e.message)) {
        recordOutcome('reverted');
        setPhase('error');
        setError('Transaction reverted. No swap or contribution was completed.');
      } else if (submission.current) {
        recordOutcome('unknown');
        setPhase('unknown');
        setError(
          'A transaction was submitted, but its confirmation is unavailable. Check its status before sending another.',
        );
      } else {
        setPhase('error');
        setError(userFacingError(e));
      }
    } finally {
      setBusy('');
    }
  }
  async function checkTransaction() {
    if (!hash || busy) return;
    setBusy('Checking transaction');
    setError('');
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      recordOutcome(receipt.status === 'success' ? 'confirmed' : 'reverted');
      setPhase(receipt.status === 'success' ? 'success' : 'error');
      if (receipt.status === 'reverted')
        setError('Transaction reverted. No swap or contribution was completed.');
      refresh().catch((e) => {
        setError(userFacingError(e));
        setReady(false);
      });
    } catch {
      setPhase('unknown');
      setError('Confirmation is still unavailable. Use the explorer link before retrying.');
    } finally {
      setBusy('');
    }
  }
  async function contractAction(
    kind: 'faucet' | 'contribute' | 'claim' | 'refund',
    token = deployedTokens[0],
  ) {
    const wallet = await getWallet();
    if (kind === 'faucet') {
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: token.address,
        abi: faucetAbi,
        functionName: 'faucet',
      });
      await getWallet();
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
      await getWallet();
      return wallet.writeContract({ ...request, chain: arcTestnet });
    }
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: deployedLaunchpad,
      abi: launchpadAbi,
      functionName: kind,
    });
    await getWallet();
    return wallet.writeContract({ ...request, chain: arcTestnet });
  }
  const blocked = !!busy || phase === 'unknown';
  const expired = !!quote && clock - quote.quotedAt >= 30000;
  const validSwap =
    ready &&
    connected &&
    input > 0n &&
    input <= (balances[from.symbol] || 0n) &&
    !!quote &&
    quote.amountIn === input &&
    quote.path[0] === from.address &&
    !blocked;
  const start = BigInt(deployment.sale.start),
    end = BigInt(deployment.sale.end);
  const saleOpen = !!sale && !sale.cancelled && sale.timestamp >= start && sale.timestamp < end;
  const failed = !!sale && (sale.cancelled || (sale.timestamp >= end && !sale.successful));
  return {
    ready,
    checking,
    error,
    busy,
    phase,
    hash,
    from,
    to,
    connected,
    amount,
    setAmount,
    quote,
    quoteError,
    balances,
    claimed,
    allowance,
    saleAllowance,
    saleAmount,
    setSaleAmount,
    sale,
    review,
    setReview,
    input,
    contribution,
    blocked,
    expired,
    validSwap,
    saleOpen,
    failed,
    end,
    reversePair: () => {
      setReverse((v) => !v);
      setAmount('');
    },
    retry: () => setAttempt((n) => n + 1),
    refreshQuote: () => {
      setReview(false);
      setTick((n) => n + 1);
    },
    checkTransaction,
    approveSwap: () =>
      action(`Approve ${from.symbol}`, async (submitted) =>
        approveExact(await getWallet(), from.address, deployedRouter, input, submitted),
      ),
    resetSwap: () =>
      action('Reset router allowance', async () =>
        revokeAllowance(await getWallet(), from.address, deployedRouter),
      ),
    swap: () =>
      quote &&
      action(
        'Swap',
        async (submitted) =>
          (await executeV2(await getWallet(), quote, slippageBps, submitted)).transactionHash,
      ),
    faucet: (token: (typeof deployedTokens)[number]) =>
      action(`Claim ${token.symbol}`, () => contractAction('faucet', token)),
    approveSale: () =>
      action('Approve sale payment', async (submitted) =>
        approveExact(
          await getWallet(),
          deployedTokens[0].address,
          deployedLaunchpad,
          contribution,
          submitted,
        ),
      ),
    resetSale: () =>
      action('Reset sale allowance', async () =>
        revokeAllowance(await getWallet(), deployedTokens[0].address, deployedLaunchpad),
      ),
    contribute: () => action('Contribute', () => contractAction('contribute')),
    claimSale: () => action('Claim sale tokens', () => contractAction('claim')),
    refundSale: () => action('Refund', () => contractAction('refund')),
  };
}
