---
title: Run the reference editor
description: Start the complete example and identify the source files that demonstrate integration.
---

The reference editor is [Aelion Studio](https://github.com/FoyonaCZY/AelionStudio). Clone it into
`apps/editor-demo` (this path is gitignored in AelionSDK so both repos can live in one working tree).
It is not a supported UI component library and does not define how your product must look.

## Start it

Clone [Aelion Studio](https://github.com/FoyonaCZY/AelionStudio) into `apps/editor-demo` first, then
from the AelionSDK root:

```bash
git clone https://github.com/FoyonaCZY/AelionStudio.git apps/editor-demo
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm dev:editor
```

Open the printed URL and use representative MP4/WebM media. Verify:

- file import and probe;
- first-frame preview, zoom/fit, scrub, play, pause, and seek;
- timeline selection and semantic edits with undo/redo;
- capability and export preflight;
- MP4/WebM/image/audio output where supported;
- project replacement and terminal cleanup.

## Source map

| File                                                                                   | What to learn                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`vite.config.ts`](https://github.com/FoyonaCZY/AelionStudio/blob/main/vite.config.ts) | Vite plugin, runtime assets, and isolation headers                          |
| [`src/main.ts`](https://github.com/FoyonaCZY/AelionStudio/blob/main/src/main.ts)       | Provider, Project, Session, Preview, Player, commands, and Export lifecycle |
| [`src/style.css`](https://github.com/FoyonaCZY/AelionStudio/blob/main/src/style.css)   | Demo layout only; not SDK API                                               |

The smaller `apps/quickstart` keeps the whole first workflow in one TypeScript file. Use it when
learning the API; use the reference editor when studying a product-shaped lifecycle.

## Move the pattern into your application

1. Create one editor runtime owner for provider/Session/preview/player.
2. Split committed Project state from selection, pointer, panel, and task state.
3. Wrap Session commands in a product command layer for permissions, snapping, history, and errors.
4. Subscribe to committed revisions instead of maintaining a second mutable timeline.
5. Move probe, thumbnails, waveforms, autosave, proxy, and export into cancellable task objects.
6. Implement open/replace/close as idempotent lifecycle operations.

## What the example does not solve

It does not provide accounts, permissions, media library, collaboration, autosave policy, keyboard
mapping, accessibility review, localization, production telemetry, durable task service, or design
system. Those remain application responsibilities.

Build a production bundle with:

```bash
corepack pnpm build:editor
```

Then continue with [Editor UI integration](/AelionSDK/guides/editor-ui/).
