import { defineConfig } from 'vitest/config';

import { buildViteAliases } from './scripts/package-aliases';

export default defineConfig({
  resolve: {
    alias: buildViteAliases(),
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
