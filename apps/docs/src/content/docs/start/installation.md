---
title: Install and configure
description: Install the published packages, configure Vite or deploy runtime assets yourself.
---

## Install the release candidate

```bash
npm install @aelionsdk/sdk@next @aelionsdk/export@next
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

The `next` tag currently resolves to `1.0.0-rc.1`. Pin that exact version for reproducible applications after validating it in your target browsers.

## Vite

```ts
import { aelion } from '@aelionsdk/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [aelion()] });
```

The plugin serves the Renderer Worker, Export Worker and AudioWorklet entries. Non-Vite ESM/CDN hosts must copy those four assets to a static directory and pass their URLs through `runtimeAssets`.

## Verify the published package

```bash
npm view @aelionsdk/sdk@1.0.0-rc.1 version dist.integrity dist.attestations --json
npm view @aelionsdk/sdk dist-tags --json
```

The browser must be cross-origin isolated for SharedArrayBuffer-backed worker paths. Always run capability probes and export preflight at runtime; browser names alone do not guarantee codec, WebGPU or hardware encoder support.
