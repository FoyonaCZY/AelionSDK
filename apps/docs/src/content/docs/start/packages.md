---
title: Which packages should I install?
description: Choose AelionSDK packages for product integration, Material authoring, or engine extension.
---

## Normal editing products

Start with:

```bash
npm install @aelionsdk/sdk@next
```

The SDK facade includes Project and Composition builders, media registration, Session, commands,
preview, playback, export facade, diagnostics, persistence helpers, migration, and runtime
Materials.

For Vite, also install:

```bash
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

Install `@aelionsdk/export` directly when application code needs OPFS/memory sinks, remote provider
types, profile metadata, or checkpointed lower-level export.

```bash
npm install @aelionsdk/export@next
```

Non-Vite hosts still install runtime dependencies and deploy the documented Worker/Worklet assets;
they do not import internal package files.

## Material development

```bash
npm install --save-dev @aelionsdk/material-sdk@next
```

It supplies typed graph/definition builders, deterministic packing, validation, Material Lab,
signing/trust, migrations, golden helpers, and the `aelion-material` CLI. A product that only runs
already-installed Materials can normally stay on `@aelionsdk/sdk`.

## Lower-level packages

| Package                        | Use it directly only for                                   |
| ------------------------------ | ---------------------------------------------------------- |
| `@aelionsdk/core`              | diagnostics, JSON/time primitives, low-level extensions    |
| `@aelionsdk/project-schema`    | custom Project tooling and server validation               |
| `@aelionsdk/transaction`       | custom engine host or editing integration                  |
| `@aelionsdk/render-ir`         | custom renderer/exporter                                   |
| `@aelionsdk/media`             | custom byte source, index, decoder, cache, or proxy system |
| `@aelionsdk/audio`             | custom PCM/audio-clock host                                |
| `@aelionsdk/renderer-worker`   | custom rendering surface/worker integration                |
| `@aelionsdk/capability`        | standalone capability laboratory                           |
| `@aelionsdk/material-compiler` | custom Material tooling or backend                         |

Prefer Session APIs over recreating the SDK's internal dependency graph in application code.

## Version and import rules

- Keep all `@aelionsdk/*` packages on the same exact release.
- The npm `next` tag currently points to `1.2.0-rc.1`; pin it after validation.
- Import only package names and documented subpath exports.
- Never import `src/*`, generated `dist/*`, test helpers, or another workspace package's internals.
- Browser support remains runtime capability/preflight, not a package-selection rule.

See [Packages and public entry points](/AelionSDK/reference/packages/) for the complete 13-package
map and the generated API Reference for exact symbols.
