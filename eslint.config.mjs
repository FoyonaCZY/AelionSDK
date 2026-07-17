import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.astro/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'apps/*/vite.config.js',
      'benchmarks/reports/**',
      'reports/**',
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
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
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
      'packages/*/check-*.mjs',
      'packages/*/test/**/*.mjs',
      'packages/*/test/fixtures/**/*.js',
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
