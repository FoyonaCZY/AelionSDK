---
title: Playback and audio
description: Implement play, pause, seek, browser gesture handling, audio timing, and player diagnostics.
---

## Minimal controls

Load a Project, attach preview, then use `session.player.play()`, `pause()`, and `seek(timeUs)`.
Reflect the Player snapshot in UI rather than assuming a click immediately changed state.

## Player state

Track ready/playing/paused/seeking/ended/error, current timeline time, rate, buffering/stall data,
audio transport, and the diagnostic that caused a terminal error.

## Seek, scrub, and render

Seek changes playback position. Scrubbing is a product interaction that may pause, request many
preview frames, and seek once at completion. `preview.render()` alone does not move the audio clock.

## Audio as master clock

When audio is active, AudioWorklet timing is the authority and video is scheduled against it.
Falling behind may drop an obsolete video frame; stretching the timeline interpretation to preserve
every visual frame would create A/V drift.

## Browser gesture restrictions

Create/resume audio in response to a user gesture and surface a clear “enable audio” state when the
browser blocks it. Do not hide autoplay rejection as a generic playback failure.

## Transport mode

Cross-origin isolation enables the preferred shared-memory path. Without it, Aelion uses a bounded
transferable fallback where supported. Capability reports expose the active mode so products can
set expectations.

## Preview quality and edits

Set a playback-appropriate preview quality. If a commit occurs during playback, consume the new
revision through the documented Player/Session transition; do not let a UI store combine an old
audio graph with a new visual snapshot.

## Monitoring and disposal

Watch underruns, queue depth, dropped video frames, clock drift, decode/render latency, and
`PLAYER_RUNTIME_FAILED`. Stop and dispose the Player before disposing the Session and media owner.
