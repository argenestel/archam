import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const rpcProxy = Object.fromEntries(
  [
    ['/api/arc-rpc', 'https://rpc.testnet.arc.io'],
    ['/api/arc-rpc-quicknode', 'https://rpc.quicknode.testnet.arc.io'],
    ['/api/arc-rpc-drpc', 'https://rpc.drpc.testnet.arc.io'],
    ['/api/arc-rpc-mainnet', 'https://rpc.mainnet.arc.io'],
    ['/api/arc-rpc-mainnet-quicknode', 'https://rpc.quicknode.mainnet.arc.io'],
    ['/api/arc-rpc-mainnet-drpc', 'https://rpc.drpc.mainnet.arc.io'],
  ].map(([route, target]) => [
    `^${route}$`,
    {
      target,
      changeOrigin: true,
      secure: true,
      rewrite: () => '/',
      timeout: 10000,
      proxyTimeout: 10000,
    },
  ]),
);
export default defineConfig({
  plugins: [react()],
  server: { proxy: rpcProxy },
  preview: { proxy: rpcProxy },
  build: {
    rollupOptions: { output: { manualChunks: { web3: ['viem'], react: ['react', 'react-dom'], icons: ['lucide-react'] } } },
  },
});
