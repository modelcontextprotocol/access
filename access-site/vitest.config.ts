import { defineConfig } from 'vitest/config';

// Tests run in plain Node (24+), which provides WebCrypto, fetch, Request and
// Response. D1 is replaced with node:sqlite (see test/helpers.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
