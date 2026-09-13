import { http, createConfig } from "wagmi";
import { arcTestnet } from "viem/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const config = createConfig({
  chains: [arcTestnet],
  ssr: true,
  connectors: connectorsForWallets(
    [{ groupName: "Connect your wallet", wallets: [injectedWallet, ...(projectId ? [walletConnectWallet] : [])] }],
    // The browser connector needs no project ID. Only include WalletConnect when configured.
    { appName: "Mofu", projectId },
  ),
  transports: { [arcTestnet.id]: http() },
});
