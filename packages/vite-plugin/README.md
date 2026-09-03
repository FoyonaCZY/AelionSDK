# `@aelionsdk/vite-plugin`

Official Vite integration plus Webpack/Rspack and explicit CDN helpers for AelionSDK's module
Worker and AudioWorklet entry files.

## Install

```bash
pnpm add @aelionsdk/sdk
pnpm add -D @aelionsdk/vite-plugin vite
```

```ts
// vite.config.ts
import { aelion } from '@aelionsdk/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

No asset paths or workspace aliases are required. During `vite build`, the plugin emits the
published `@aelionsdk/renderer-worker` WebGL2 Worker, the `@aelionsdk/export` mux Worker, and both
published `@aelionsdk/audio` AudioWorklet entry chunks, then rewrites the SDK package URLs to the
generated hashed files. During `vite dev`, it exposes equivalent virtual module URLs through
Vite's module server.

The optional flags are only for applications that never load the corresponding runtime:

```ts
aelion({ audioWorklets: true, exportWorker: true, rendererWorker: true });
```

All flags default to `true`. A disabled asset group must not be used by application code.

## Webpack and Rspack

```ts
import { AelionWebpackPlugin, aelionRuntimeAssetUrls } from '@aelionsdk/vite-plugin';

// webpack.config.ts / rspack.config.ts
export default {
  plugins: [new AelionWebpackPlugin()],
};

// Client-only application module
const runtimeAssets = aelionRuntimeAssetUrls('/');
```

The adapter emits stable `aelion/{audio,renderer-worker,export}` paths and works against the
Webpack 5-compatible hooks exposed by Rspack. Pass `runtimeAssets` to `Aelion.createSession()`.

For a custom build or CDN copy step, use `loadAelionRuntimeAssets(outputDirectory)`. For an
already-deployed versioned CDN directory, use
`aelionRuntimeAssetUrls('https://cdn.example/sdk/2.0.0/')`; keep application modules and all four
runtime entries on the same SDK version.

Production pages should use HTTPS. For the SharedArrayBuffer audio path, also return `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. CSP must allow same-origin `worker-src` and `script-src`.

This package is part of [AelionSDK](https://github.com/FoyonaCZY/AelionSDK). Public API changes
follow SemVer.
