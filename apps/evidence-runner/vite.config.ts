import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@aelionsdk/audio': fileURLToPath(
        new URL('../../packages/audio/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/export': fileURLToPath(
        new URL('../../packages/export/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/material-compiler': fileURLToPath(
        new URL('../../packages/material-compiler/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/media': fileURLToPath(
        new URL('../../packages/media/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/project-schema': fileURLToPath(
        new URL('../../packages/project-schema/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/render-ir': fileURLToPath(
        new URL('../../packages/render-ir/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/renderer-worker': fileURLToPath(
        new URL('../../packages/renderer-worker/src/index.ts', import.meta.url),
      ),
      '@aelionsdk/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
      '@aelionsdk/transaction': fileURLToPath(
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
