---
title: Real-time preview and scrubbing
description: Connect Session to Canvas, cancel stale scrubs, tune quality, and manage frame ownership.
---

## Attach the main Canvas

Use `attachPreviewCanvas(session, canvas, options)` and await `render(timeUs)` for the first frame.
Choose `contain`, `cover`, or an explicit product transform; choose adaptive quality for editing
and full quality for review.

## Canvas and pointer mapping

CSS size, backing-store size, device pixel ratio, Project dimensions, and fit/letterbox transform
are different coordinate spaces. Keep one mapping utility and reject pointer positions outside the
visible Project canvas.

## Capture

Canvas capture is a browser presentation stream, not the authoritative export path. Use it for
live UI integrations only; use Session export for deterministic offline output.

## Scrubbing

Pause playback or enter a scrub mode, convert pointer position to a snapped `timeUs`, and call
`preview.render(timeUs)`. Reuse the controller and allow it to cancel stale requests. Update the
display only for the latest requested time.

## Playback interaction

`preview.render()` renders a requested frame; `player.seek()` moves playback state. During a drag,
the product may preview many positions, then seek once when the gesture ends and resume only if it
was playing before.

## Quality modes

Interactive mode can lower scale/material quality and prioritize latency. Review mode should
restore the intended preview contract. Never present a proxy/adaptive result as pixel-identical
export evidence.

## Thumbnails

Use bounded concurrency, lower resolution, visibility-based scheduling, and cancellation. Close
every returned `VideoFrame` after drawing or transfer it exactly once.

## Direct frame ownership

Advanced hosts may subscribe to frames rather than use the Canvas controller. The subscriber then
owns drawing, stale-result rejection, color/presentation behavior, and `VideoFrame.close()`.

## Statistics and cleanup

Monitor requested/rendered/dropped/cancelled frames, queue depth, render/decode duration, backend,
scale, and resource counts. Dispose frame subscribers and preview controllers before the Session.
