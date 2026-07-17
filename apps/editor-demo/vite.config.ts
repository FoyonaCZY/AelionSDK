import { fileURLToPath } from 'node:url';

import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [aelion()],
  build: { outDir: 'dist', sourcemap: true },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
});
