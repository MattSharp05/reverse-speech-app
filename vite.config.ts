import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  // The trivia pack (~1.2 MB, ~270 KB gzipped) is its own chunk, loaded by the TV only.
  build: { chunkSizeWarningLimit: 1300 },
  test: { include: ['src/**/*.test.ts'] },
});
