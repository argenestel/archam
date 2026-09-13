import { http, createConfig } from "wagmi";
import { arcTestnet } from "viem/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { arcMainnet, arcMainnetRouteConfig } from "./arc-mainnet-config";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const config = createConfig({
  chains: [arcTestnet, arcMainnet],
  ssr: true,
  connectors: connectorsForWallets(
    [{ groupName: "Connect your wallet", wallets: [injectedWallet, ...(projectId ? [walletConnectWallet] : [])] }],
    // The browser connector needs no project ID. Only include WalletConnect when configured.
    { appName: "Mofu", projectId },
  ),
  transports: {
    [arcTestnet.id]: http(),
    [arcMainnet.id]: http(arcMainnetRouteConfig.rpcUrl || undefined),
  },
});
