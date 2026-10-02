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
import { createWalletClient, custom, keccak256, type Abi, type Address, type Hash } from 'viem';
import { activeChain, client } from './arc';
import { codeHashes } from './contracts';
import { userFacingError } from './errors';
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
  if (!code || keccak256(code) !== expected) throw new Error('Contract verification failed. Trading is paused for your safety.');
  verified.add(key);
}
let toastId = 0;

export function TxProvider({ children }: { children: ReactNode }) {
  const { address, onArc, provider } = useWallet();
  const [tx, setTx] = useState<TxState>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unresolved, setUnresolved] = useState<LocalTransaction>();
  const busy = useRef(false);

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
          (t.status === 'pending' || t.status === 'unknown'),
      ),
    );
  }, [address]);

  const recheck = useCallback(async () => {
    const record = unresolved;
    if (!record) return;
    try {
      const receipt = await client.getTransactionReceipt({ hash: record.hash });
      saveTransaction({ ...record, status: receipt.status === 'success' ? 'confirmed' : 'reverted' });
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
      if (unresolved) {
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
        saveTransaction({ hash, account: address, chainId: activeChain.id, label, status, time: Date.now() });
      try {
        if (!provider || !address || !onArc) throw new Error(`Connect your wallet on ${activeChain.name}.`);
        const wallet = createWalletClient({ account: address, chain: activeChain, transport: custom(provider) });
        const [current] = await wallet.getAddresses();
        if (current?.toLowerCase() !== address.toLowerCase() || (await wallet.getChainId()) !== activeChain.id)
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
          setTx({ label, phase: 'unknown', hash, error: 'Submitted, but confirmation is unavailable.' });
          notify({ tone: 'error', title: `${label}: confirmation unavailable`, body: 'Check the explorer before retrying.', hash });
          findUnresolved();
          return false;
        }
        if (receipt.status !== 'success') {
          record('reverted');
          setTx({ label, phase: 'reverted', hash, error: 'Transaction reverted. Nothing changed.' });
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
          setTx({ label, phase: 'unknown', hash, error: 'Submitted, but confirmation is unavailable.' });
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
    [address, onArc, provider, unresolved, notify, findUnresolved],
  );

  const value = useMemo(
    () => ({
      tx,
      busy: tx?.phase === 'signing' || tx?.phase === 'pending',
      send,
      unresolved,
      recheck,
      toasts,
      notify,
      dismiss,
    }),
    [tx, send, unresolved, recheck, toasts, notify, dismiss],
  );
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx() {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error('useTx outside TxProvider');
  return ctx;
}
