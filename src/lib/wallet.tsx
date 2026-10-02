import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type Address, type EIP1193Provider } from 'viem';
import { activeChain, client } from './arc';
import { userFacingError } from './errors';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
export type WalletInfo = { id: string; name: string; icon?: string; provider: EIP1193Provider };
type WalletState = {
  address?: Address;
  chainId?: number;
  onArc: boolean;
  wallets: WalletInfo[];
  provider?: EIP1193Provider;
  gas?: bigint;
  pending: boolean;
  error: string;
  connect: (wallet: WalletInfo) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  clearError: () => void;
};
const WalletContext = createContext<WalletState | null>(null);
const storageKey = 'orbit.wallet.v2';
const remembered = () => {
  try {
    return localStorage.getItem(storageKey) || '';
  } catch {
    return '';
  }
};
const remember = (id: string) => {
  try {
    if (id) localStorage.setItem(storageKey, id);
    else localStorage.removeItem(storageKey);
  } catch {
    /* optional convenience only */
  }
};

/** EIP-6963 discovery with a window.ethereum fallback for older injected wallets. */
function useDiscoveredWallets() {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  useEffect(() => {
    const found = new Map<string, WalletInfo>();
    const publish = () => setWallets([...found.values()]);
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent).detail ?? {};
      if (!info?.rdns || !provider) return;
      found.set(info.rdns, { id: info.rdns, name: info.name, icon: info.icon, provider });
      publish();
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const fallback = setTimeout(() => {
      if (!found.size && window.ethereum) {
        found.set('injected', { id: 'injected', name: 'Browser wallet', provider: window.ethereum });
        publish();
      }
    }, 300);
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(fallback);
    };
  }, []);
  return wallets;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useDiscoveredWallets();
  const [active, setActive] = useState<WalletInfo>();
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [gas, setGas] = useState<bigint>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  // Restore an already-authorized session silently; never prompt on load.
  useEffect(() => {
    if (active) return;
    const id = remembered();
    const wallet = wallets.find((w) => w.id === id);
    if (!wallet) return;
    Promise.all([
      wallet.provider.request({ method: 'eth_accounts' }),
      wallet.provider.request({ method: 'eth_chainId' }),
    ])
      .then(([accounts, chain]) => {
        if (!accounts[0]) return;
        setActive(wallet);
        setAddress(accounts[0] as Address);
        setChainId(Number(chain));
      })
      .catch(() => undefined);
  }, [wallets, active]);

  useEffect(() => {
    const provider = active?.provider;
    if (!provider) return;
    const onAccounts = (value: unknown) => {
      const next = (value as string[])[0] as Address | undefined;
      setAddress(next);
      setGas(undefined);
      if (!next) remember('');
    };
    const onChain = (value: unknown) => {
      setChainId(Number(value));
      setGas(undefined);
    };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener('accountsChanged', onAccounts);
      provider.removeListener('chainChanged', onChain);
    };
  }, [active]);

  const onArc = !!address && chainId === activeChain.id;
  useEffect(() => {
    if (!onArc || !address) return;
    let ignore = false;
    const load = () =>
      client
        .getBalance({ address })
        .then((b) => !ignore && setGas(b))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 20_000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [onArc, address, revision]);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener('orbit:transactions', refresh);
    return () => window.removeEventListener('orbit:transactions', refresh);
  }, []);

  const connect = useCallback(async (wallet: WalletInfo) => {
    setPending(true);
    setError('');
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
      setActive(wallet);
      setAddress(accounts[0] as Address);
      setChainId(Number(await wallet.provider.request({ method: 'eth_chainId' })));
      remember(wallet.id);
    } catch (e) {
      setError(userFacingError(e, 'Could not connect the wallet. Open it and try again.'));
    } finally {
      setPending(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const provider = active?.provider;
    if (!provider) return;
    setPending(true);
    setError('');
    const chainHex = `0x${activeChain.id.toString(16)}` as const;
    try {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainHex,
              chainName: activeChain.name,
              nativeCurrency: activeChain.nativeCurrency,
              rpcUrls: [...activeChain.rpcUrls.default.http],
              blockExplorerUrls: [activeChain.blockExplorers.default.url],
            },
          ],
        });
      }
      setChainId(Number(await provider.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(userFacingError(e, `Could not switch networks. Select ${activeChain.name} in your wallet.`));
    } finally {
      setPending(false);
    }
  }, [active]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      onArc,
      wallets,
      provider: active?.provider,
      gas,
      pending,
      error,
      connect,
      switchNetwork,
      clearError: () => setError(''),
      disconnect: () => {
        setActive(undefined);
        setAddress(undefined);
        setGas(undefined);
        remember('');
      },
    }),
    [address, chainId, onArc, wallets, active, gas, pending, error, connect, switchNetwork],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}

/** Opens the app's wallet picker from anywhere. */
export const openConnect = () => window.dispatchEvent(new Event('orbit:connect'));
