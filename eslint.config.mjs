import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '.perf/**',
      '**/coverage/**',
      '**/.astro/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'apps/*/vite.config.js',
      'apps/editor-demo/**',
      'benchmarks/reports/**',
      'reports/**',
      'fixtures/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './apps/*/tsconfig.json',
          './examples/typescript/tsconfig.json',
          './packages/*/tsconfig.json',
          './tsconfig.test.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Preserve the pre-ESLint 10 policy baseline. Enable these in a dedicated
      // lint-hardening change after the existing findings have been remediated.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    files: [
      'scripts/**/*.mjs',
      'benchmarks/**/*.mjs',
      'apps/docs/scripts/**/*.mjs',
      'packages/*/check-*.mjs',
      'packages/*/test/**/*.mjs',
      'packages/*/test/fixtures/**/*.js',
      'apps/docs/src/content.config.ts',
      'scripts/competitor-benchmark-entry.ts',
      'eslint.config.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        OffscreenCanvas: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        VideoFrame: 'readonly',
      },
      sourceType: 'module',
    },
  },
);
