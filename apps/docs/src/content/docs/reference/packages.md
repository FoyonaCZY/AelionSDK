---
title: Packages and public entry points
description: Understand the responsibilities and intended consumers of the 13 @aelionsdk packages.
---

All public packages are currently `1.2.0` under npm `latest`. Only paths declared by a
package's `exports` field are public API; `src/*`, `dist/*`, tests, and internal helpers are not.

## Stability tiers

| Tier            | Packages                                                                                                   | Intended use                            |
| --------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Product entry   | `sdk`, `export`, `vite-plugin`                                                                             | Application developers                  |
| Extension entry | `material-sdk`, `project-schema`                                                                           | Material, importer, and Project tooling |
| Advanced engine | `core`, `capability`, `media`, `material-compiler`, `render-ir`, `renderer-worker`, `audio`, `transaction` | Custom hosts and engine contributors    |

All packages share a release version, but direct use of an advanced package opts into a narrower
compatibility boundary; follow SemVer, CHANGELOG and the API snapshot.

## Product entry packages

### `@aelionsdk/sdk`

Main application surface: `Aelion.createSession()`, Composition and Project builders, time helpers,
production media providers, Canvas preview, Session/Player/Transaction/Export APIs, audio analysis
and mastering, persistence, migration, isolated Worker extensions, runtime Material registry, and
default Project schema.

### `@aelionsdk/export`

Seekable memory/OPFS sinks, export profile metadata, remote provider/authorizer contracts,
checkpointed muxed export, Worker exporter, and lower-level profile functions. Applications using
Session export normally import only sinks and remote types from this package.

### `@aelionsdk/vite-plugin`

Emits and wires Renderer Worker, Export Worker, and AudioWorklet runtime assets. The package also
provides Webpack/Rspack integration and helpers for custom copy, Next client boundaries, and CDN
asset URLs.

### `@aelionsdk/material-sdk`

Typed graph/definition builders, deterministic package creation, registry/catalog, Material Lab,
signature and trust store, migrations, golden helpers, and the `aelion-material` CLI.

## Advanced packages

| Package             | Responsibility                                                   |
| ------------------- | ---------------------------------------------------------------- |
| `core`              | errors, diagnostics, JSON types, time/frame/sample math          |
| `project-schema`    | Project v1 types, validation, canonical input admission          |
| `transaction`       | semantic editing, transaction engine, history, change sets       |
| `render-ir`         | Project compilation and audio/visual evaluation contract         |
| `media`             | range I/O, MP4/WebM indexing, seek/decode, cache, proxy, budgets |
| `audio`             | PCM mix, AudioWorklet clock/transport, video scheduling          |
| `renderer-worker`   | worker protocol and WebGL2/WebGPU compositing                    |
| `capability`        | GPU, codec, audio, storage, stream, WASM, and color probes       |
| `material-compiler` | graph type checking, Core Nodes, backend compilation, budgets    |

Prefer Session APIs whenever they cover the use case. See the generated API Reference for exact
symbols and `packages/sdk/api-snapshot.md` for the reviewed export surface.
