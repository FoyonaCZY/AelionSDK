import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aelion/capability': fileURLToPath(
        new URL('./packages/capability/src/index.ts', import.meta.url),
      ),
      '@aelion/audio': fileURLToPath(new URL('./packages/audio/src/index.ts', import.meta.url)),
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
  test: {
    coverage: {
      enabled: false,
      include: ['packages/*/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    environment: 'node',
    exclude: ['**/dist/**', '**/node_modules/**', '**/*.browser.test.ts', '**/*.golden.test.ts'],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    // Several suites deliberately run CPU-heavy bounded simulations and
    // canonical Project validation in parallel. Keep the timeout above their
    // measured loaded-host duration so CI reports logic failures, not scheduler
    // starvation on shared runners.
    testTimeout: 15_000,
    sequence: {
      concurrent: true,
    },
  },
});
