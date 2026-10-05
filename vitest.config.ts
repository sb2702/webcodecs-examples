import { defineConfig } from 'vitest/config';

// @moq/* packages use extensionless ESM imports, so let Vite resolve them instead of Node
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    server: { deps: { inline: [/@moq\//] } },
  },
});
