import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aelion/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@aelion/material-compiler': fileURLToPath(
        new URL('./packages/material-compiler/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.golden.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
