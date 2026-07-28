---
title: Troubleshoot by symptom
description: Diagnose import, preview, scrub, playback, sync, export, OPFS, deployment, and leaks.
---

## `probe()` fails after file selection

Confirm the File is non-empty and still authorized, inspect `MEDIA_*` diagnostics, test a known
supported MP4/WebM, and distinguish corrupt/unsupported input from a cancelled or budgeted probe.

## Project loads but Canvas is black

Verify the requested time is inside a visible item, the asset ID is registered, the item/track is
enabled, the Canvas has a non-zero backing size, runtime worker URLs load, and renderer diagnostics
do not report backend loss or unsupported Material/color behavior.

## Scrubbing becomes slower

Reuse one preview controller, cancel stale requests, close direct frames, bound thumbnails/cache,
avoid a render per raw pointer event, and inspect decode/render queue statistics.

## Play does nothing or has no audio

Resume audio from a user gesture, inspect Player state/diagnostics, confirm the sequence has active
audio and unmuted tracks, and verify AudioWorklet assets plus isolation/fallback capability.

## Audio/video drift

Use the Player audio clock, avoid maintaining an independent UI timer, inspect underruns/dropped
video frames, verify source timestamps/time maps, and test without heavy background jobs.

## H.264 export unavailable

Run exact preflight. Check `VideoEncoder` and `AudioEncoder`, resolution/frame rate/bitrate, AAC
canary, color/material constraints, and sink. Offer WebM, lower settings, or remote export.

## Failed job or zero-byte file

Await the job and sink finalization, inspect `EXPORT_*` diagnostics, check quota/writer lock, run
cleanup for the partial target, and do not download before finalization.

## Remote media starts but cannot seek

Inspect network responses for `206`, correct `Content-Range`, stable content length/identity,
credentials on range requests, and CORS exposure. A `200` full response is not a valid large-file
range path.

## Worker or Worklet 404 in production

Use emitted runtime asset URLs, include the deployment base path, keep MIME/CSP correct, and verify
files after the final build/deploy rather than relying on dev-server paths.

## Memory does not fall after switching

Abort jobs, dispose preview/player/Session/provider in order, close every `VideoFrame`, revoke object
URLs, remove listeners/timers, and wait for bounded caches before comparing terminal counts.

## Bug report

Include SDK/browser/OS, capability and preflight reports, stable diagnostic codes, safe media
metadata, minimal Project or reproduction, exact steps, expected/actual outcome, stats, and whether
cleanup completed. Do not attach private media or credentials without an approved channel.
