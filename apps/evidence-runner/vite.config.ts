import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@aelion/audio': fileURLToPath(new URL('../../packages/audio/src/index.ts', import.meta.url)),
      '@aelion/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@aelion/export': fileURLToPath(
        new URL('../../packages/export/src/index.ts', import.meta.url),
      ),
      '@aelion/material-compiler': fileURLToPath(
        new URL('../../packages/material-compiler/src/index.ts', import.meta.url),
      ),
      '@aelion/media': fileURLToPath(new URL('../../packages/media/src/index.ts', import.meta.url)),
      '@aelion/project-schema': fileURLToPath(
        new URL('../../packages/project-schema/src/index.ts', import.meta.url),
      ),
      '@aelion/render-ir': fileURLToPath(
        new URL('../../packages/render-ir/src/index.ts', import.meta.url),
      ),
      '@aelion/renderer-worker': fileURLToPath(
        new URL('../../packages/renderer-worker/src/index.ts', import.meta.url),
      ),
      '@aelion/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
      '@aelion/transaction': fileURLToPath(
        new URL('../../packages/transaction/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
});
