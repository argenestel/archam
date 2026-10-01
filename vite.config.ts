import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks: { web3: ['viem'], react: ['react', 'react-dom'] } } },
  },
});
