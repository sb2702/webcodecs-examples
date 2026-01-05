import { defineConfig } from 'vite';
import { resolve } from 'path';

// Library build configuration
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // Bundle all dependencies into the library
      output: {
        // Ensure assets use relative paths
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
    sourcemap: true,
    outDir: 'dist',
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
      },
    },
  },
  optimizeDeps: {
    exclude: [],
  },
});
