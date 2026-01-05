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
      // Bundle everything into single file
      output: {
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
    outDir: 'dist',
  },
  worker: {
    format: 'es',
  },
});
