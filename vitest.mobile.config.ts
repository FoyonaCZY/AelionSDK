import { defineConfig } from 'vitest/config';

import { buildViteAliases } from './scripts/package-aliases';

const alias = buildViteAliases();

export default defineConfig({
  define: { __AELION_CONFORMANCE_TARGET__: JSON.stringify('mobile') },
  resolve: { alias },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  test: {
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [
        {
          browser: 'chromium',
          headless: true,
          launch: { args: ['--autoplay-policy=no-user-gesture-required'], channel: 'chrome' },
          context: {
            viewport: { width: 390, height: 844 },
            screen: { width: 390, height: 844 },
            deviceScaleFactor: 3,
            hasTouch: true,
            isMobile: true,
          },
        },
      ],
    },
    include: [
      'packages/capability/test/capability.browser.test.ts',
      'packages/sdk/test/target-conformance.browser.test.ts',
    ],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
