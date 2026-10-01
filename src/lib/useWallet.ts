import { useEffect, useState } from 'react';
import { formatUnits, type EIP1193Provider } from 'viem';
import { arcTestnet, client } from './arc';
import { userFacingError } from './errors';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
export function useWallet() {
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<number>();
  const [balance, setBalance] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accounts = (value: unknown) => {
      setAddress((value as string[])[0]);
      setBalance(undefined);
    };
    const chain = (value: unknown) => {
      setChainId(Number(value));
      setBalance(undefined);
    };
    provider.on('accountsChanged', accounts);
    provider.on('chainChanged', chain);
    return () => {
      provider.removeListener('accountsChanged', accounts);
      provider.removeListener('chainChanged', chain);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (address && chainId === arcTestnet.id)
      client
        .getBalance({ address: address as `0x${string}` })
        .then((b) => {
          if (!cancelled) setBalance(formatUnits(b, 18));
        })
        .catch(() => {
          if (!cancelled) setBalance(undefined);
        });
    return () => {
      cancelled = true;
    };
  }, [address, chainId]);
  async function connect() {
    setPending(true);
    setError('');
    try {
      if (!window.ethereum)
        throw new Error('Install an Ethereum-compatible wallet such as MetaMask to connect.');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAddress(accounts[0]);
      setChainId(Number(await window.ethereum.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(userFacingError(e, 'Could not connect the wallet. Open it and try again.'));
    } finally {
      setPending(false);
    }
  }
  async function switchNetwork() {
    setPending(true);
    setError('');
    try {
      if (!window.ethereum) return;
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${arcTestnet.id.toString(16)}` }],
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: `0x${arcTestnet.id.toString(16)}`,
              chainName: arcTestnet.name,
              nativeCurrency: arcTestnet.nativeCurrency,
              rpcUrls: [...arcTestnet.rpcUrls.default.http],
              blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
            },
          ],
        });
      }
      setChainId(Number(await window.ethereum.request({ method: 'eth_chainId' })));
    } catch (e) {
      setError(userFacingError(e, 'Could not switch networks. Select Arc testnet in your wallet.'));
    } finally {
      setPending(false);
    }
  }
  return {
    address,
    chainId,
    balance,
    pending,
    error,
    connect,
    switchNetwork,
    disconnect: () => {
      setAddress(undefined);
      setBalance(undefined);
    },
  };
}
