---
title: Quickstart — local video to MP4
description: Follow Project, Media Provider, Session, preview, editing, undo, and export end to end.
---

The matching runnable application is `apps/quickstart`. Start it first:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev:quickstart
```

## Integration order

```text
File / URL → ProductionMediaProvider → Project JSON → Session
                                      ├─ Preview and Player
                                      ├─ Transaction and History
                                      └─ Export
```

Project persists asset IDs and timeline semantics. The media provider supplies bytes at runtime.
Session validates and executes the Project.

## 1. Prepare the page

Create a file input, Canvas, scrub control, play/pause buttons, edit/undo buttons, export button,
and status/progress area. Keep one runtime owner for provider, Session, preview, and object URLs.

## 2. Register the selected File

```ts
import { ProductionMediaProvider } from '@aelionsdk/sdk';

const media = new ProductionMediaProvider();
media.registerFile('asset_main', file);
const probe = await media.probe('asset_main');
```

Use the probe to confirm tracks, duration, dimensions, and compatible input. Do not place `file`
inside Project JSON.

## 3. Create a Project from probe data

```ts
import { createProject } from '@aelionsdk/sdk';

const video = probe.index.tracks.find(track => track.kind === 'video');
const builder = createProject({
  projectId: 'quickstart_project',
  sequenceId: 'main_sequence',
  title: file.name,
  width: video?.codedWidth ?? 1920,
  height: video?.codedHeight ?? 1080,
  frameRate: { numerator: 30, denominator: 1 },
});

await builder.importMedia({
  provider: media,
  assetId: 'asset_main',
  name: file.name,
});

const project = builder.build();
```

`build()` validates builder output. Product-level authored graphics can use
[Composition API](/AelionSDK/guides/composition-api/); both paths produce Project v2.

## 4. Create Session and render the first frame

```ts
import { Aelion, attachPreviewCanvas } from '@aelionsdk/sdk';

const session = await Aelion.createSession({ media });
await session.loadProject(project);

const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
});
await preview.render(0);
```

Reuse this preview controller. A failed load does not leave a half-installed Project.

## 5. Play and scrub

```ts
await session.player.play();
session.player.pause();
await session.player.seek(timeUs);
await preview.render(timeUs);
```

Browsers may require `play()` from a user gesture to start audio. During pointer scrub, pause,
render the newest requested time, let stale renders cancel, then seek once at pointer-up and resume
only if playback was active before.

## 6. Edit and undo

Read stable item IDs from the current snapshot, then submit a semantic command:

```ts
const before = session.getSnapshot();
const itemId = Object.keys(before.project?.items ?? {})[0];

if (itemId) {
  session.transaction.commands.moveItem({
    itemId,
    startUs: 1_000_000,
    baseRevision: before.revision,
  });
}

if (session.transaction.history.canUndo) session.transaction.history.undo();
```

Use the exact API Reference types for the current command signature. A revision conflict or invalid
move leaves Project and history unchanged.

## 7. Export H.264 MP4

```ts
import { SeekableMemorySink } from '@aelionsdk/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  cleanupSink: () => sink.cleanup(),
};

const preflight = await session.export.preflightProfile(options);
if (!preflight.ok) {
  throw new Error(preflight.issues.map(issue => issue.code).join(', '));
}

await session.export.startProfile(options);
const bytes = sink.finalize();
const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
```

Expose progress and cancellation in real UI. For long output, use `OpfsSeekableSink` instead of
holding the complete file in memory. Revoke the download URL after use.

## 8. Dispose

On project replacement or page shutdown:

1. stop new UI requests and abort background tasks;
2. dispose preview/frame subscribers;
3. stop/dispose Player;
4. cancel or await export and clean partial sinks;
5. dispose Session;
6. revoke object URLs and dispose the media provider.

## Completion check

You should now have a real source registered outside Project JSON, a validated Project loaded into
Session, first-frame preview, gesture-safe playback and scrub, one semantic edit plus undo, exact
export preflight, a completed MP4 or actionable unsupported result, and terminal cleanup.

Next, read [Editor UI integration](/AelionSDK/guides/editor-ui/) and
[Importing and managing media](/AelionSDK/guides/media-import/).
