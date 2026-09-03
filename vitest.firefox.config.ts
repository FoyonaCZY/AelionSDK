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
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      api: { host: '127.0.0.1', port: 63315, strictPort: false },
      instances: [
        {
          browser: 'firefox',
          headless: true,
          launch: {
            firefoxUserPrefs: {
              'media.autoplay.default': 0,
              'media.autoplay.blocking_policy': 0,
              'media.cubeb.backend': 'null',
            },
          },
        },
      ],
    },
    include: [
      'packages/capability/test/capability.browser.test.ts',
      'packages/media/test/decode.browser.test.ts',
      'packages/audio/test/worklet.browser.test.ts',
      'packages/renderer-worker/test/compose.browser.test.ts',
      'packages/renderer-worker/test/ir-renderer.browser.test.ts',
      'packages/export/test/export.browser.test.ts',
      'packages/sdk/test/session.browser.test.ts',
      'packages/sdk/test/player-race.browser.test.ts',
    ],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
