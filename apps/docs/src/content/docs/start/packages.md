---
title: Choose packages
description: Start with the SDK facade and add focused packages only when your application needs them.
---

Most applications install:

```bash
npm install @aelionsdk/sdk@next
```

The current `next` release is `1.0.0-rc.1`; pin `@aelionsdk/sdk@1.0.0-rc.1` when you need a reproducible dependency graph.

Add `@aelionsdk/export` when you manage sinks and export jobs directly, and add `@aelionsdk/vite-plugin` for Vite runtime asset wiring.

| Package | Use it for |
| --- | --- |
| `@aelionsdk/sdk` | Public facade: Project, Session, media registration, preview, playback and migration CLI. |
| `@aelionsdk/export` | Profiles, muxing, sinks and resumable export jobs. |
| `@aelionsdk/media` | Container indexing, range reads, VideoFrame and PCM decoding. |
| `@aelionsdk/render-ir` | Canonical render instructions and deterministic composition. |
| `@aelionsdk/material-sdk` | Authoring and running custom Materials. |
| `@aelionsdk/vite-plugin` | Vite worker and AudioWorklet asset integration. |

The remaining packages are lower-level building blocks. Prefer the facade unless you are implementing a custom renderer, provider, worker boundary or schema tool.
