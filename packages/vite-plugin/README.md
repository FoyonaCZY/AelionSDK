# `@aelion/vite-plugin`

Official Vite integration for AelionSDK's module Worker and AudioWorklet entry files.

## Install

```bash
pnpm add @aelion/sdk
pnpm add -D @aelion/vite-plugin vite
```

```ts
// vite.config.ts
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

No asset paths or workspace aliases are required. During `vite build`, the plugin emits the published `@aelion/renderer-worker` WebGL2 Worker and both published `@aelion/audio` AudioWorklet entry chunks, then rewrites the SDK package URLs to the generated hashed files. During `vite dev`, it exposes equivalent virtual module URLs through Vite's module server.

The optional flags are only for applications that never load the corresponding runtime:

```ts
aelion({ audioWorklets: true, rendererWorker: true });
```

Both flags default to `true`. A disabled asset group must not be used by application code.

Production pages should use HTTPS. For the SharedArrayBuffer audio path, also return `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. CSP must allow same-origin `worker-src` and `script-src`.

This package is part of [AelionSDK](https://github.com/FoyonaCZY/AelionSDK). The `0.1.0-alpha.0` API may change.
