import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { ifdyCompanion } from './server/vite-plugin';

export default defineConfig({
  plugins: [react(), ifdyCompanion()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    host: 'localhost',
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
