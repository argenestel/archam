"use client";

import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "./wagmi";
import type { ReactNode } from "react";
import { Theme as RadixTheme } from "@radix-ui/themes";
import { ThemeProvider, useTheme } from "./theme";

const qc = new QueryClient();

export default function WalletProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider><WalletTheme>{children}</WalletTheme></ThemeProvider>;
}

function WalletTheme({ children }: { children: ReactNode }) {
  const { mode } = useTheme();
  const theme = (mode === "dark" ? darkTheme : lightTheme)({
    accentColor: "#D6FF62", accentColorForeground: "#151B09",
    borderRadius: "medium", overlayBlur: "none",
  });
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RadixTheme appearance={mode} accentColor="lime" grayColor="sage" radius="medium" scaling="100%">
          <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>
        </RadixTheme>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
