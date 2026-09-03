import { defineConfig } from 'vitest/config';

import { buildViteAliases } from './scripts/package-aliases';

export default defineConfig({
  resolve: {
    alias: buildViteAliases(),
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  test: {
    // Browser GPU/context budgets are shared across tabs. Serial files keep the
    // certification matrix deterministic; same-page concurrency has dedicated
    // admission, cancellation and multi-instance resource tests.
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      // An explicit IPv4 loopback avoids Windows resolving `localhost` to ::1
      // while Vite's API server is listening only on IPv4.
      api: { host: '127.0.0.1', port: 63315, strictPort: false },
      instances: [
        {
          browser: 'chromium',
          launch: {
            args: ['--autoplay-policy=no-user-gesture-required'],
            channel: 'chrome',
            headless: true,
          },
        },
      ],
    },
    include: ['packages/**/*.browser.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
