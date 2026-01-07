import { defineConfig } from 'vite';
import { resolve } from 'path';

// Demo build configuration for MoQ
export default defineConfig({
  root: resolve(__dirname, '../../'),
  publicDir: resolve(__dirname, '../../public'),

  build: {
    outDir: resolve(__dirname, '../../dist-demo/moq'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },

  server: {
    port: 3000,
    open: '/demos/moq/index.html',
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
  },
});
