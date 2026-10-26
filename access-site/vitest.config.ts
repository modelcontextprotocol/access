import { defineConfig } from 'vitest/config';

// Tests run in plain Node (22+), which provides WebCrypto, fetch, Request and
// Response. Cloudflare bindings (KV) are replaced with in-memory fakes.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
