---
title: Integrate the SDK into an editor UI
description: Organize Project state, view state, Session lifecycle, product commands, and asynchronous work.
---

## Separate four kinds of state

1. **Persistent Project state** — assets, sequences, tracks, items, materials, and settings.
2. **Engine runtime state** — Session, provider, player, preview, export, revision, and diagnostics.
3. **View state** — selection, zoom, scroll, panels, pointer gestures, and temporary previews.
4. **Product state** — account, permissions, autosave, collaboration, jobs, and asset library.

Only the first category belongs in Project JSON.

## Recommended flow

UI intent goes through a product command layer, then a semantic Session command. A successful
commit emits a revision/change set; the store reads the corresponding snapshot and derives visible
rows, inspector values, and task invalidation. Avoid maintaining a second mutable timeline model.

## Editor runtime

Create a small owner object that constructs the media provider and Session, loads one Project,
attaches preview/player, subscribes to events, and disposes everything in reverse order. Make open,
close, and replacement idempotent and cancel stale asynchronous work.

## Coordinates

Convert pointer pixels using the current timeline origin, pixels-per-microsecond scale, scroll, and
zoom. Apply product snapping, clamp to safe integer microseconds, then call the command layer.
Canvas pointer mapping must also account for device pixel ratio and the preview fit transform.

## Product command layer

Centralize permission checks, lock policy, selection normalization, linked-edit options, current
revision, history grouping, diagnostics, and analytics around SDK commands. Do not let components
mutate normalized Project maps directly.

## Continuous inspector changes

Keep the immediate slider/drag value in view state, open one interaction history group, submit
validated updates, and close or cancel the group at interaction end. One gesture should produce one
undo entry.

## Preview, thumbnails, and jobs

Use one main preview controller. `session.media.thumbnail()` and `session.media.filmstrip()` share a
bounded, serial decode budget with playback, so timeline decoration cannot create one competing
decoder per clip. Cancel requests as soon as their cells leave the visible band and close every
returned bitmap:

```ts
const controller = new AbortController();
const thumbnail = await session.media.thumbnail({
  assetId,
  sourceTimeUs: 2_000_000,
  maxDimension: 320,
  signal: controller.signal,
});
try {
  paintThumbnail(thumbnail);
} finally {
  thumbnail.close();
}

const strip = await session.media.filmstrip({ itemId, count: 8, frameHeight: 64 });
try {
  paintFilmstrip(strip.bitmap, strip.frameWidth, strip.timesUs);
} finally {
  strip.bitmap.close();
}
```

Represent probe, proxy, waveform, autosave, and export as explicit jobs with identity, progress,
cancellation, diagnostics, and terminal state.

Frame subscriptions are exclusive owners: the sole `player.subscribe()` listener must close each
frame bitmap. UI elements that only need the playhead should use the lightweight, multi-listener
`subscribeTime()` channel instead:

```ts
const unsubscribeTime = session.player.subscribeTime(({ timeUs, state }) => {
  playheadStore.update(timeUs, state);
});

// When the timeline is no longer watched:
unsubscribeTime();
await session.player.reset();
```

`pause()` keeps decoders and audio transport warm; `reset()` releases them and returns the Player
to `idle`.

## Open and close

Restore Project JSON, reconnect media, create/load Session, attach UI resources, and only then
enable editing. On close, block new commands, abort jobs, flush or cancel persistence/export, stop
playback, dispose previews and Session, then release media.
