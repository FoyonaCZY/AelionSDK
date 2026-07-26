import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const alias = {
  '@aelion/audio': fileURLToPath(new URL('./packages/audio/src/index.ts', import.meta.url)),
  '@aelion/capability': fileURLToPath(
    new URL('./packages/capability/src/index.ts', import.meta.url),
  ),
  '@aelion/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
  '@aelion/export': fileURLToPath(new URL('./packages/export/src/index.ts', import.meta.url)),
  '@aelion/media': fileURLToPath(new URL('./packages/media/src/index.ts', import.meta.url)),
  '@aelion/project-schema': fileURLToPath(
    new URL('./packages/project-schema/src/index.ts', import.meta.url),
  ),
  '@aelion/render-ir': fileURLToPath(new URL('./packages/render-ir/src/index.ts', import.meta.url)),
  '@aelion/renderer-worker': fileURLToPath(
    new URL('./packages/renderer-worker/src/index.ts', import.meta.url),
  ),
  '@aelion/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
  '@aelion/transaction': fileURLToPath(
    new URL('./packages/transaction/src/index.ts', import.meta.url),
  ),
};

export default defineConfig({
  define: { __AELION_CONFORMANCE_TARGET__: JSON.stringify('webkit') },
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
      instances: [{ browser: 'webkit', headless: true }],
    },
    include: [
      'packages/capability/test/capability.browser.test.ts',
      'packages/sdk/test/target-conformance.browser.test.ts',
    ],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
