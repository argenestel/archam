import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
export default function nextConfig(phase) {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const mainnet = process.env.VITE_ARC_NETWORK === 'mainnet';
  return {
    // Keep the existing client-only app and nginx deployment model.
    output: development ? undefined : 'export',
    distDir: mainnet ? (development ? '.next-mainnet' : 'out-mainnet') : '.next',
    reactStrictMode: true,
    devIndicators: false,
    allowedDevOrigins: ['127.0.0.1'],
    // Retain the existing TypeScript 5 compiler API for build-time checks.
    experimental: { useTypeScriptCli: false },
    // Explicit allowlist: existing public settings work without exposing server secrets.
    env: {
      VITE_ARC_NETWORK: process.env.VITE_ARC_NETWORK ?? 'testnet',
      VITE_MAINNET_SIGNING: process.env.VITE_MAINNET_SIGNING ?? '0',
    },
    ...(development
      ? {
          async rewrites() {
            return [
              { source: '/api/arc-rpc', destination: 'https://rpc.testnet.arc.io/' },
              {
                source: '/api/arc-rpc-quicknode',
                destination: 'https://rpc.quicknode.testnet.arc.io/',
              },
              { source: '/api/arc-rpc-drpc', destination: 'https://rpc.drpc.testnet.arc.io/' },
              { source: '/api/arc-rpc-mainnet', destination: 'https://rpc.mainnet.arc.io/' },
              {
                source: '/api/arc-rpc-mainnet-quicknode',
                destination: 'https://rpc.quicknode.mainnet.arc.io/',
              },
              {
                source: '/api/arc-rpc-mainnet-drpc',
                destination: 'https://rpc.drpc.mainnet.arc.io/',
              },
              {
                source: '/api/media/:path*',
                destination: 'http://127.0.0.1:5192/api/media/:path*',
              },
            ];
          },
        }
      : {}),
  };
}
