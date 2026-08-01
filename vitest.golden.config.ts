import { defineConfig } from 'vitest/config';

import { buildViteAliases } from './scripts/package-aliases';

export default defineConfig({
  resolve: {
    alias: buildViteAliases(),
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.golden.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
