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
  // Imported only by the pixel-diff worker, which the dependency scan does not crawl: without this,
  // its first use in dev re-optimizes dependencies and reloads the whole studio.
  optimizeDeps: { include: ['pixelmatch'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
