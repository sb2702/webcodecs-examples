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
    },
    sourcemap: true,
    outDir: 'dist',
  },
  worker: {
    format: 'es',
  },
});
