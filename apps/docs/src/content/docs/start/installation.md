---
title: Install and configure
description: Install the AelionSDK 1.0 release candidate, run the examples, and configure a production host.
---

## Requirements

- Node.js `20.19.x` for repository development.
- Corepack and the repository-pinned pnpm `10.13.1`.
- A modern secure-context browser for runtime features.
- Vite 6/7 for the first-party Vite integration, or a host that can deploy ESM Worker/Worklet assets.

## Install published packages

```bash
npm install @aelionsdk/sdk@next @aelionsdk/export@next
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

`next` currently resolves to `1.1.0-rc.1`. After validation, pin the exact version:

```bash
npm install @aelionsdk/sdk@1.1.0-rc.1 @aelionsdk/export@1.1.0-rc.1
npm install --save-dev @aelionsdk/vite-plugin@1.1.0-rc.1
```

All `@aelionsdk/*` packages in one application should use the same release.

## Run the repository Quickstart

```bash
git clone https://github.com/FoyonaCZY/AelionSDK.git
cd AelionSDK
corepack pnpm install --frozen-lockfile
corepack pnpm dev:quickstart
```

Open the printed local URL, choose an MP4 or WebM, and verify first-frame preview, scrub, playback,
move/undo, and MP4 export.

The fuller editor example is available with:

```bash
corepack pnpm dev:editor
```

## Create an application in the workspace

Use a normal Vite TypeScript application and add its package to the pnpm workspace. Depend on
workspace packages with the same version policy and do not import package `src` or `dist` paths.

## Configure Vite

```ts
// vite.config.ts
import { aelion } from '@aelionsdk/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

The plugin emits and wires the Renderer Worker, Export Worker, Player AudioWorklet, and renderer
AudioWorklet assets. Production URLs include the deployment base path.

For SharedArrayBuffer-backed audio transport, configure development and production responses:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

All cross-origin media, fonts, scripts, workers, and images must satisfy CORS/CORP when isolation is
enabled.

## Non-Vite and CDN hosts

Do not import package internals from a CDN URL. Install or fetch the exact public packages, copy the
four runtime assets to your static deployment, then pass absolute URLs through
`AelionSessionOptions.runtimeAssets`. The Vite package also exposes:

- `AelionWebpackPlugin` for Webpack 5/Rspack;
- `loadAelionRuntimeAssets()` for a custom copy pipeline;
- `aelionRuntimeAssetUrls()` for a Next client boundary or pinned CDN layout.

CDN paths must pin the exact SDK version, for example `@aelionsdk/sdk/1.1.0-rc.1/`.

## TypeScript

Use a modern ES target and DOM/WebWorker libraries appropriate to the host. Keep `strict` enabled.
Do not add broad ambient shims for WebCodecs or workers merely to silence an older TypeScript
configuration; use the repository-supported compiler and public types.

## Why cross-origin isolation matters

Isolation enables the preferred shared-memory Worker/AudioWorklet transport. Without it, supported
browsers use a bounded transferable fallback with different performance. Capability reports expose
the active mode; the application should not test browser names.

## Verify a production build

Build and serve the final output over HTTP(S), not `file://`. Confirm:

1. all Worker/Worklet assets return 200 with correct MIME;
2. base paths work from nested routes;
3. CSP allows only the required worker, connect, media, image, and font origins;
4. `crossOriginIsolated` matches the intended header policy;
5. a real file probes, previews, plays, seeks, and exports;
6. project switch/disposal returns resources to budget.

## Lock the exact version

Commit the lockfile and use frozen installs in CI. RC APIs can change before stable; read
`CHANGELOG.md` and the migration guide before changing versions.

## Verify release identity

```bash
npm view @aelionsdk/sdk@1.1.0-rc.1 \
  version dist.integrity dist.attestations --json
npm view @aelionsdk/sdk dist-tags --json
```

Cross-check the [Git tag `v1.1.0-rc.1`](https://github.com/FoyonaCZY/AelionSDK/tree/v1.1.0-rc.1),
the [release workflow](https://github.com/FoyonaCZY/AelionSDK/actions/runs/30343884270), and the
[GitHub prerelease](https://github.com/FoyonaCZY/AelionSDK/releases/tag/v1.1.0-rc.1).

Continue with [From a local video to MP4](/AelionSDK/start/getting-started/).
