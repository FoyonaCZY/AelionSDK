# AelionSDK

**Languages:** **English** · [简体中文](README.zh-CN.md)

Browser-first TypeScript SDK for timeline editing, deterministic preview/playback and local or
remote media export.

[![CI](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aelionsdk/sdk/latest?label=npm)](https://www.npmjs.com/package/@aelionsdk/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)

[English documentation](https://foyonaczy.github.io/AelionSDK/) ·
[中文文档](https://foyonaczy.github.io/AelionSDK/zh/) ·
[Roadmap](https://foyonaczy.github.io/AelionSDK/project/roadmap/) ·
[Current status](https://foyonaczy.github.io/AelionSDK/project/status/)

## Install 2.0

```bash
npm install @aelionsdk/sdk @aelionsdk/export
npm install --save-dev @aelionsdk/vite-plugin vite
```

<!-- aelion-current-version:start -->

Repository version: `2.0.0`. The npm badge shows the currently published `latest` version. Pin
the exact release after validating it on your target devices.

<!-- aelion-current-version:end -->

> **1.x remediation notice:** `1.1.0-rc.1` and `1.2.0-rc.1` are superseded. Do not newly adopt either
> RC. `1.2.0-rc.2` corrected their schema identity/migration, image-sequence runtime, signed-rate,
> subtitle, Bézier, streaming-proxy, audio-analysis and codec-fallback contract issues.
> `1.2.0-rc.3` kept those remediations and fixed preview transforms, still-image indexing, Vite 7
> worker URLs, and `historyGroup` forwarding. `1.2.0-rc.4` added faster interactive commits, text
> background plates, transient thumbnail decodes, and steadier playback/seek. rc.5 pools
> WebGL2 compositor resources, reuses the export bypass on preview, and honours preview
> `maxDimension` at the provider boundary. `1.2.0` is the first stable 1.2: it freezes reused
> Render IR, hands preview frames over uncopied, and reuses audio PCM sessions. Stable releases
> publish to npm under the `latest` dist-tag.

AelionSDK 2.0 adds an explicit storyline/overlay timeline model, reusable layout planning, safe
Item factories, speculative drag compilation, thumbnail/filmstrip APIs and lower-cost validation.
The Project schema has a new immutable `v2.0.json` / `2.0.0` identity; v1.0 and v1.2 documents are
migrated from ownership-isolated snapshots.

The 2.0.0 final gate passed all 21 serial commands with unchanged source manifest
`9ff6cf17f2ae5f11c0e245e6b534b90d647db623dd7f7905318077d84b3de8ab`. It includes 598 Node
tests, 118 Project-schema tests, Chromium 102/102 and Firefox 76/76 browser conformance, WebKit and
mobile contract checks, all 13 package tarball consumers, release dry-run and byte-for-byte
reproducibility. Publication additionally requires an independently approved review bound to this
exact source, gate result and artifact set.

## What it provides

- Transactional timeline editing, revisions, undo/redo, markers, linked A/V and nested Sequences.
- Storyline packing, exclusive/free occupancy, gap Items and reusable drag/drop layout planning.
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

New Projects use the immutable `v2.0.json` / `2.0.0` schema identity. The validator safely upgrades
supported v1.0 and stable v1.2 documents without mutating caller-owned data; call
`migrateProjectToCurrent()` when the upgraded document should be persisted.

## Known boundaries

- Physical Safari/iOS/Android and broad GPU/driver matrices are not certified.
- Local color execution is RGBA8 SDR; HDR/10-bit contracts fail closed when unsupported.
- The SDK ships no executable WASM codec fallback. The capability registry describes host-owned
  backends but does not route media or export work through them.
- SRT/WebVTT are supported; ASS/SSA is not yet part of the subtitle contract.
- Audio beat/energy analysis is not pixel-based video scene detection.
- WebGPU supports documented paths but does not yet have complete WebGL2 parity certification.
- Public APIs follow SemVer; Project schema identities are immutable once published.

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
