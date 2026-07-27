import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aelionsdk/capability': fileURLToPath(
        new URL('./packages/capability/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/audio': fileURLToPath(new URL('./packages/audio/src/index.ts', import.meta.url)),
      '@aelionsdk/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@aelionsdk/export': fileURLToPath(
        new URL('./packages/export/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/media': fileURLToPath(new URL('./packages/media/src/index.ts', import.meta.url)),
      '@aelionsdk/material-compiler': fileURLToPath(
        new URL('./packages/material-compiler/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/project-schema': fileURLToPath(
        new URL('./packages/project-schema/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/render-ir': fileURLToPath(
        new URL('./packages/render-ir/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/renderer-worker': fileURLToPath(
        new URL('./packages/renderer-worker/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
      '@aelionsdk/transaction': fileURLToPath(
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
