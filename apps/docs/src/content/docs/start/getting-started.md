---
title: From a local video to MP4
description: Import a local file, preview it, edit the timeline and export an H.264 MP4.
---

This tutorial takes one local video through the complete public workflow: register media, create a Project, render the first frame, play and scrub, move a clip, undo the edit, and export H.264/AAC MP4.

Run the matching example first:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev:quickstart
```

## The data flow

```text
File / URL → ProductionMediaProvider → Project JSON → Session
                                      ├─ preview / player
                                      ├─ transaction
                                      └─ export
```

Project stores stable asset IDs and timeline data, not the media bytes. Reconnect those IDs to File, URL, OPFS or a custom provider when reopening a project.

## Minimal integration

```ts
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
} from '@aelionsdk/sdk';

const media = new ProductionMediaProvider();
media.registerFile('asset_main', file);
const probe = await media.probe('asset_main');
const video = probe.index.tracks.find(track => track.kind === 'video');

const builder = createProject({
  projectId: 'quickstart_project',
  sequenceId: 'main_sequence',
  title: file.name,
  width: video?.codedWidth ?? 1920,
  height: video?.codedHeight ?? 1080,
  frameRate: { numerator: 30, denominator: 1 },
});
await builder.importMedia({ provider: media, assetId: 'asset_main', name: file.name });

const session = await Aelion.createSession({ media });
await session.loadProject(builder.build());
const preview = attachPreviewCanvas(session, canvas, { quality: 'adaptive', fit: 'contain' });
await preview.render(0);
```

Timeline time is expressed in integer microseconds. `preview.render()` cancels stale requests during scrubbing; call `session.player.seek()` when playback should resume.

## Export with preflight

Use `@aelionsdk/export` and run `session.export.preflightProfile(options)` before starting an export. If the report is not OK, show the issue codes to the user instead of silently changing formats. Memory sinks are suitable for short clips; use OPFS or a remote sink for long renders.

When the page is closed, dispose the preview, Session and media provider in that order. Continue with [editor UI integration](/AelionSDK/zh/guides/editor-ui/) and [media import](/AelionSDK/zh/guides/media-import/).
