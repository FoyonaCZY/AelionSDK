import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aelion/audio': fileURLToPath(new URL('./packages/audio/src/index.ts', import.meta.url)),
      '@aelion/capability': fileURLToPath(
        new URL('./packages/capability/src/index.ts', import.meta.url),
      ),
      '@aelion/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@aelion/export': fileURLToPath(new URL('./packages/export/src/index.ts', import.meta.url)),
      '@aelion/media': fileURLToPath(new URL('./packages/media/src/index.ts', import.meta.url)),
      '@aelion/material-compiler': fileURLToPath(
        new URL('./packages/material-compiler/src/index.ts', import.meta.url),
      ),
      '@aelion/project-schema': fileURLToPath(
        new URL('./packages/project-schema/src/index.ts', import.meta.url),
      ),
      '@aelion/render-ir': fileURLToPath(
        new URL('./packages/render-ir/src/index.ts', import.meta.url),
      ),
      '@aelion/renderer-worker': fileURLToPath(
        new URL('./packages/renderer-worker/src/index.ts', import.meta.url),
      ),
      '@aelion/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
      '@aelion/transaction': fileURLToPath(
        new URL('./packages/transaction/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
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
