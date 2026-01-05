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
      // Externalize dependencies that shouldn't be bundled
      external: ['localforage', 'mp4box', 'mp4-muxer'],
      output: {
        globals: {
          localforage: 'localforage',
          mp4box: 'MP4Box',
          'mp4-muxer': 'Mp4Muxer',
        },
      },
    },
    sourcemap: true,
    outDir: 'dist',
  },
  worker: {
    format: 'es',
  },
});
