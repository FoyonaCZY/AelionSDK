# AelionSDK

**Languages:** **English** · [简体中文](README.zh-CN.md)

Browser-first TypeScript SDK for timeline editing, deterministic preview/playback and local or
remote media export.

[![CI](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml)
[![npm next](https://img.shields.io/npm/v/@aelionsdk/sdk/next?label=npm%20next)](https://www.npmjs.com/package/@aelionsdk/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)

[English documentation](https://foyonaczy.github.io/AelionSDK/) ·
[中文文档](https://foyonaczy.github.io/AelionSDK/zh/) ·
[Roadmap](https://foyonaczy.github.io/AelionSDK/project/roadmap/) ·
[Current status](https://foyonaczy.github.io/AelionSDK/project/status/)

## Install the 1.2 release candidate

```bash
npm install @aelionsdk/sdk@next @aelionsdk/export@next
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

Repository version: `1.2.0-rc.2`. The npm badge shows the currently published `next` version. Pin
an exact prerelease after validating it on your target devices.

> **Remediation notice:** `1.1.0-rc.1` and `1.2.0-rc.1` are superseded. Do not newly adopt either
> RC. `1.2.0-rc.2` corrects their schema identity/migration, image-sequence runtime, signed-rate,
> subtitle, Bézier, streaming-proxy, audio-analysis and codec-fallback contract issues. Until rc.2
> appears in the registry, wait instead of resolving `@next` to an older RC.

The final remediation gate passed all 21 serial commands with unchanged source manifest
`9d61b2124b579812ca413a588c7b1384eebc1e477f728304d8bd45fedbe86006`. Release eligibility still
depends on the independently reviewed, exact-bound evidence record in `reports/baseline`.

## What it provides

- Transactional timeline editing, revisions, undo/redo, markers, linked A/V and nested Sequences.
- Image, video, audio, text, caption, shape, generator, mask, transition and Material composition.
- WebCodecs-backed media indexing/decoding, HTTP Range and OPFS access, bounded caches and proxies.
- WebGL2/WebGPU worker composition, Canvas preview, AudioWorklet playback and shared Render IR.
- MP4/WebM, still image, GIF and WAV/RF64 export with exact capability preflight and resumable sinks.
- Canonical Project JSON, migration, IndexedDB recovery, runtime diagnostics and remote export.

The public surface is split into focused `@aelionsdk/*` packages. Most products begin with
`@aelionsdk/sdk`; use `@aelionsdk/export` for direct export APIs and the Vite plugin to emit Worker
and AudioWorklet assets.

## Vite setup

```ts
// vite.config.ts
import { aelion } from '@aelionsdk/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [aelion()] });
```

## Start a Session

```ts
import { Aelion, ProductionMediaProvider, createProject } from '@aelionsdk/sdk';

const media = new ProductionMediaProvider();
const session = await Aelion.createSession({ media });
const project = createProject({
  projectId: 'project_main',
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
}).build();

await session.loadProject(project);
```

New Projects use the immutable `v1.2.json` / `1.2.0` schema identity. The rc.2 validator safely
upgrades documents emitted by 1.1/1.2 rc.1 with the ambiguous v1.0 identity; call
`migrateProjectToCurrent()` when the upgraded document should be persisted.

## Important RC boundaries

- Physical Safari/iOS/Android and broad GPU/driver matrices are not certified.
- Local color execution is RGBA8 SDR; HDR/10-bit contracts fail closed when unsupported.
- The SDK ships no executable WASM codec fallback. The capability registry describes host-owned
  backends but does not route media or export work through them.
- SRT/WebVTT are supported; ASS/SSA is not yet part of the subtitle contract.
- Audio beat/energy analysis is not pixel-based video scene detection.
- WebGPU supports documented paths but does not yet have complete WebGL2 parity certification.
- RC APIs may still change through documented migration/deprecation before the first stable release.

See the [audited 1.1](https://foyonaczy.github.io/AelionSDK/project/roadmap/1-1/) and
[1.2](https://foyonaczy.github.io/AelionSDK/project/roadmap/1-2/) delivery tables for exact status.

## Development

Requires Node.js 24 and Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:pack
```

Migration, release and evidence commands are documented in the
[development guide](https://foyonaczy.github.io/AelionSDK/project/development/).

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
