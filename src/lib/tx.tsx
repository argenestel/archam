import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createWalletClient,
  custom,
  keccak256,
  type Abi,
  type Address,
  type Hash,
  type EIP1193Provider,
} from 'viem';
import { activeChain, client } from './arc';
import { codeHashes } from './contracts';
import { userFacingError } from './errors';
import { externalOutcome, readExternal, saveExternal, type ExternalPending } from './external';
import { readTransactions, saveTransaction, type LocalTransaction } from './transactions';
import { useWallet } from './wallet';

export type TxRequest = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};
export type TxPhase = 'signing' | 'pending' | 'confirmed' | 'reverted' | 'unknown' | 'error';
export type TxState = { label: string; phase: TxPhase; hash?: Hash; error?: string };
export type Toast = {
  id: number;
  tone: 'info' | 'success' | 'error' | 'pending';
  title: string;
  body?: string;
  hash?: Hash;
  action?: { label: string; href: string };
};
type TxContextValue = {
  tx?: TxState;
  busy: boolean;
  /** Sends one contract call. Resolves true only for a confirmed, successful receipt. */
  send: (label: string, request: TxRequest) => Promise<boolean>;
  /** Runs an SDK-driven flow (Circle App Kit) that signs through the wallet itself. */
  runExternal: (
    label: string,
    fn: (provider: EIP1193Provider) => Promise<unknown>,
  ) => Promise<boolean>;
  externalPending?: ExternalPending;
  recheckExternal: () => Promise<void>;
  unresolved?: LocalTransaction;
  recheck: () => Promise<void>;
  toasts: Toast[];
  notify: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
};
const TxContext = createContext<TxContextValue | null>(null);
const verified = new Set<string>();
/** Refuses to sign against a manifest contract whose deployed bytecode has changed. */
async function verifyTarget(address: Address) {
  const key = address.toLowerCase();
  const expected = codeHashes.get(key);
  if (!expected || verified.has(key)) return;
  const code = await client.getCode({ address });
  if (!code || keccak256(code) !== expected)
    throw new Error('Contract verification failed. Trading is paused for your safety.');
  verified.add(key);
}
let toastId = 0;

export function TxProvider({ children }: { children: ReactNode }) {
  const { address, onArc, provider } = useWallet();
  const [tx, setTx] = useState<TxState>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unresolved, setUnresolved] = useState<LocalTransaction>();
  const busy = useRef(false);
  const [externalPending, setExternalPending] = useState<ExternalPending | undefined>(() =>
    readExternal(),
  );

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastId;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    if (toast.tone !== 'pending')
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 6500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);

  const findUnresolved = useCallback(() => {
    if (!address) return setUnresolved(undefined);
    setUnresolved(
      readTransactions().find(
        (t) =>
          t.account.toLowerCase() === address.toLowerCase() &&
          t.chainId === activeChain.id &&
          (t.status === 'pending' || t.status === 'unknown'),
      ),
    );
  }, [address]);

  const recheck = useCallback(async () => {
    const record = unresolved;
    if (!record) return;
    try {
      const receipt = await client.getTransactionReceipt({ hash: record.hash });
      saveTransaction({
        ...record,
        status: receipt.status === 'success' ? 'confirmed' : 'reverted',
      });
    } catch {
      /* still unknown; the explorer link remains available */
    }
    findUnresolved();
  }, [unresolved, findUnresolved]);

  // After reload, resolve any hash we recorded but never saw a receipt for.
  useEffect(() => {
    findUnresolved();
  }, [findUnresolved]);
  useEffect(() => {
    if (unresolved && onArc) void recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolved?.hash, onArc]);

  const send = useCallback(
    async (label: string, request: TxRequest) => {
      if (busy.current) return false;
      if (unresolved || externalPending) {
        notify({
          tone: 'error',
          title: 'Previous transaction unresolved',
          body: 'Check its status before sending another.',
        });
        return false;
      }
      busy.current = true;
      setTx({ label, phase: 'signing' });
      let hash: Hash | undefined;
      const record = (status: LocalTransaction['status']) =>
        hash &&
        address &&
        saveTransaction({
          hash,
          account: address,
          chainId: activeChain.id,
          label,
          status,
          time: Date.now(),
        });
      try {
        if (!provider || !address || !onArc)
          throw new Error(`Connect your wallet on ${activeChain.name}.`);
        const wallet = createWalletClient({
          account: address,
          chain: activeChain,
          transport: custom(provider),
        });
        const [current] = await wallet.getAddresses();
        if (
          current?.toLowerCase() !== address.toLowerCase() ||
          (await wallet.getChainId()) !== activeChain.id
        )
          throw new Error('Wallet account or network changed. Review and try again.');
        await verifyTarget(request.address);
        const { request: simulated } = await client.simulateContract({
          ...(request as Parameters<typeof client.simulateContract>[0]),
          account: address,
        });
        const estimate = await client.estimateContractGas({
          ...(request as Parameters<typeof client.estimateContractGas>[0]),
          account: address,
        });
        hash = await wallet.writeContract({
          ...(simulated as Parameters<typeof wallet.writeContract>[0]),
          account: address,
          chain: activeChain,
          gas: (estimate * 125n) / 100n,
        });
        record('pending');
        setTx({ label, phase: 'pending', hash });
        const receipt = await client
          .waitForTransactionReceipt({ hash, timeout: 90_000 })
          .catch(() => undefined);
        if (!receipt) {
          record('unknown');
          setTx({
            label,
            phase: 'unknown',
            hash,
            error: 'Submitted, but confirmation is unavailable.',
          });
          notify({
            tone: 'error',
            title: `${label}: confirmation unavailable`,
            body: 'Check the explorer before retrying.',
            hash,
          });
          findUnresolved();
          return false;
        }
        if (receipt.status !== 'success') {
          record('reverted');
          setTx({
            label,
            phase: 'reverted',
            hash,
            error: 'Transaction reverted. Nothing changed.',
          });
          notify({ tone: 'error', title: `${label} reverted`, hash });
          return false;
        }
        record('confirmed');
        setTx({ label, phase: 'confirmed', hash });
        notify({ tone: 'success', title: label, body: 'Confirmed on Arc', hash });
        return true;
      } catch (e) {
        if (hash) {
          record('unknown');
          setTx({
            label,
            phase: 'unknown',
            hash,
            error: 'Submitted, but confirmation is unavailable.',
          });
          findUnresolved();
        } else {
          const error = userFacingError(e);
          setTx({ label, phase: 'error', error });
          notify({ tone: 'error', title: label, body: error });
        }
        return false;
      } finally {
        busy.current = false;
      }
    },
    [address, onArc, provider, unresolved, externalPending, notify, findUnresolved],
  );

  const recheckExternal = useCallback(async () => {
    if (
      !externalPending ||
      !provider ||
      externalPending.account.toLowerCase() !== address?.toLowerCase() ||
      externalPending.chainId !== activeChain.id ||
      !onArc
    )
      return;
    try {
      const result = (await provider.request({
        method: 'wallet_getCallsStatus' as never,
        params: [externalPending.batchId] as never,
      })) as { status: number; receipts?: { transactionHash: Hash; status: string }[] };
      if (result.status >= 400) {
        saveExternal();
        setExternalPending(undefined);
        notify({
          tone: 'error',
          title: 'Wallet batch failed',
          body: 'Review wallet receipts before retrying.',
        });
      } else if (result.status === 200 && result.receipts?.length) {
        for (const r of result.receipts) {
          const receipt = await client.getTransactionReceipt({ hash: r.transactionHash });
          saveTransaction({
            hash: r.transactionHash,
            account: externalPending.account,
            chainId: activeChain.id,
            label: externalPending.label,
            status: receipt.status === 'success' ? 'confirmed' : 'reverted',
            time: Date.now(),
          });
        }
        saveExternal();
        setExternalPending(undefined);
        findUnresolved();
        notify({
          tone: 'info',
          title: 'Wallet batch resolved',
          body: 'Review your updated balances and transaction history.',
        });
      }
    } catch {
      notify({
        tone: 'error',
        title: 'Batch confirmation unavailable',
        body: 'Check the batch in your wallet. Do not submit it again.',
      });
    }
  }, [externalPending, provider, address, onArc, notify, findUnresolved]);

  const runExternal = useCallback(
    async (label: string, fn: (provider: EIP1193Provider) => Promise<unknown>) => {
      if (busy.current) return false;
      if (unresolved || externalPending) {
        notify({
          tone: 'error',
          title: 'Previous transaction unresolved',
          body: 'Check its status before sending another.',
        });
        return false;
      }
      if (!address || !onArc || !provider) {
        notify({
          tone: 'error',
          title: label,
          body: `Connect your wallet on ${activeChain.name}.`,
        });
        return false;
      }
      busy.current = true;
      setTx({ label, phase: 'signing' });
      const hashes = new Set<Hash>();
      let batch: ExternalPending | undefined;
      const checkWallet = async () => {
        const accounts = await provider.request({ method: 'eth_accounts' });
        const chain = await provider.request({ method: 'eth_chainId' });
        if (
          accounts[0]?.toLowerCase() !== address.toLowerCase() ||
          Number(chain) !== activeChain.id
        )
          throw new Error('Wallet account or network changed. Review and try again.');
      };
      const guarded = {
        on: provider.on?.bind(provider),
        removeListener: provider.removeListener?.bind(provider),
        request: async (args: { method: string; params?: unknown }) => {
          if (
            /^(eth_sendTransaction|eth_sendRawTransaction|wallet_sendCalls|eth_sign.*|personal_sign)$/.test(
              args.method,
            )
          )
            await checkWallet();
          const submission = [
            'eth_sendTransaction',
            'eth_sendRawTransaction',
            'wallet_sendCalls',
          ].includes(args.method);
          if (submission) {
            batch = {
              account: address,
              chainId: activeChain.id,
              label,
              batchId: 'unidentified-submission',
              time: Date.now(),
            };
            saveExternal(batch);
            setExternalPending(batch);
          }
          let result;
          try {
            result = await provider.request(args as Parameters<EIP1193Provider['request']>[0]);
          } catch (error) {
            // Only explicit rejection/unsupported/invalid-parameter outcomes establish that this request was not sent.
            if (
              submission &&
              [4001, 4200, -32601, -32602].includes(Number((error as { code?: number }).code))
            ) {
              saveExternal();
              setExternalPending(undefined);
              batch = undefined;
            }
            throw error;
          }
          if (
            (args.method === 'eth_sendTransaction' || args.method === 'eth_sendRawTransaction') &&
            typeof result === 'string' &&
            /^0x[0-9a-fA-F]{64}$/.test(result)
          ) {
            const hash = result as Hash;
            hashes.add(hash);
            saveTransaction({
              hash,
              account: address,
              chainId: activeChain.id,
              label,
              status: 'pending',
              time: Date.now(),
            });
            setTx({ label, phase: 'pending', hash });
            saveExternal();
            setExternalPending(undefined);
            batch = undefined;
          }
          if (args.method === 'wallet_sendCalls') {
            const id = typeof result === 'string' ? result : (result as { id?: string })?.id;
            if (id) {
              batch = {
                account: address,
                chainId: activeChain.id,
                label,
                batchId: id,
                time: Date.now(),
              };
              saveExternal(batch);
              setExternalPending(batch);
            }
          }
          return result;
        },
      } as EIP1193Provider;
      try {
        localStorage.setItem('orbit.external.storage-check', '1');
        localStorage.removeItem('orbit.external.storage-check');
        if ((await client.getChainId()) !== activeChain.id)
          throw new Error('RPC chain mismatch. Signing refused.');
        await checkWallet();
        const result = externalOutcome(await fn(guarded));
        if (result.batchId && !batch) {
          batch = {
            account: address,
            chainId: activeChain.id,
            label,
            batchId: result.batchId,
            time: Date.now(),
          };
          saveExternal(batch);
          setExternalPending(batch);
        }
        if (result.hash) {
          hashes.add(result.hash);
          saveTransaction({
            hash: result.hash,
            account: address,
            chainId: activeChain.id,
            label,
            status: 'pending',
            time: Date.now(),
          });
        }
        if (result.status !== 'confirmed' || !result.hash)
          throw new Error('Operation submitted or incomplete. Check your wallet before retrying.');
        for (const hash of hashes) {
          const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
          saveTransaction({
            hash,
            account: address,
            chainId: activeChain.id,
            label,
            status: receipt.status === 'success' ? 'confirmed' : 'reverted',
            time: Date.now(),
          });
          if (receipt.status !== 'success')
            throw new Error('Transaction reverted. Check the receipt.');
        }
        if (batch) {
          saveExternal();
          setExternalPending(undefined);
        }
        findUnresolved();
        setTx({ label, phase: 'confirmed', hash: result.hash });
        notify({
          tone: 'success',
          title: label,
          body: 'Receipt confirmed on Arc',
          hash: result.hash,
        });
        return true;
      } catch (e) {
        // Resolve captured approvals too, without mistaking an approved allowance for a completed action.
        for (const hash of hashes) {
          const receipt = await client.getTransactionReceipt({ hash }).catch(() => undefined);
          saveTransaction({
            hash,
            account: address,
            chainId: activeChain.id,
            label,
            status: receipt ? (receipt.status === 'success' ? 'confirmed' : 'reverted') : 'unknown',
            time: Date.now(),
          });
        }
        findUnresolved();
        const error = userFacingError(e);
        setTx({ label, phase: batch || hashes.size ? 'unknown' : 'error', error });
        notify({ tone: 'error', title: label, body: error, hash: [...hashes].at(-1) });
        return false;
      } finally {
        busy.current = false;
      }
    },
    [address, onArc, provider, unresolved, externalPending, notify, findUnresolved],
  );

  const value = useMemo(
    () => ({
      tx,
      runExternal,
      externalPending,
      recheckExternal,
      busy: tx?.phase === 'signing' || tx?.phase === 'pending',
      send,
      unresolved,
      recheck,
      toasts,
      notify,
      dismiss,
    }),
    [
      tx,
      send,
      runExternal,
      externalPending,
      recheckExternal,
      unresolved,
      recheck,
      toasts,
      notify,
      dismiss,
    ],
  );
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error('useTx outside TxProvider');
  return ctx;
}
