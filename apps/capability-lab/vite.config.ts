import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@aelion/capability': fileURLToPath(
        new URL('../../packages/capability/src/index.ts', import.meta.url),
      ),
      '@aelion/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
});
