import { defineConfig } from 'vite';
import { resolve } from 'path';

// Demo build configuration for player
export default defineConfig({
  server: {
    allowedHosts: true,
 },
  root: resolve(__dirname, '../../'),
  publicDir: resolve(__dirname, '../../public'),

  build: {
    outDir: resolve(__dirname, '../../dist-demo/player'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },

  server: {
    port: 3000,
    open: '/demos/player/index.html',
  },

  worker: {
    format: 'es',
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
  },
});
