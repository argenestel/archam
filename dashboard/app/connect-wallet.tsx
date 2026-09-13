"use client";

import {
  RainbowKitProvider,
  darkTheme,
  type Theme,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "./wagmi";
import type { ReactNode } from "react";
import { Theme as RadixTheme } from "@radix-ui/themes";

const qc = new QueryClient();

const theme: Theme = darkTheme({
  accentColor: "#e5e5e5",
  accentColorForeground: "#171717",
  borderRadius: "small",
  overlayBlur: "none",
});

export default function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RadixTheme appearance="dark" accentColor="gray" grayColor="gray" radius="small" scaling="100%">
          <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>
        </RadixTheme>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
