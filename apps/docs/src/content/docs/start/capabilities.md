---
title: What is supported today?
description: Review editing, preview, media, audio, export, and Material capabilities and boundaries.
---

This page answers what can be built with `2.0.0` and what is still a negotiated or uncertified
boundary. Exact symbols are in the generated API Reference and SDK API snapshot.

## Basic editor

The public SDK can register local/remote/OPFS media, create/load Project v2, render to Canvas, play
and seek with audio, edit with transactions/history, persist canonical snapshots, and export
locally or through an application remote provider.

## Timeline editing

Supported semantic operations include move, trim, split, ripple, roll, slip, slide, linked A/V,
track add/remove/reorder/lock/visibility, audio mute/solo, markers, revision conflict detection,
interaction history grouping, undo, and redo. Commands fail atomically when source handles,
ownership, locks, transitions, or mapping rules cannot be preserved.

## Time, animation, and rate

Time is integer microseconds with rational frame rates and half-open ranges. Items support source
mapping, linear rate, curve time-mapping (authored through the builder or compiled from a rate
envelope via `buildRateEnvelope`), transforms/opacity, keyframes/easing, and validated transition
intervals. Unsupported edit policies for complex mapping/animation fail closed.

## Visual composition

Project/Composition can represent media, images, text, shapes, captions, nested sequences, masks,
effects, transitions, generators, transforms, blend/composite behavior, and Materials. Image
sequences (uniform-duration still frames) are modeled as `image-sequence` Assets and sampled
deterministically through the frame mapping. Captions are first-class: SRT and WebVTT import and
export, caption tracks with styled clips, and silence-aware cue alignment. Preview and export share
Render IR semantics.

Current local color execution is RGBA8 SDR. P3/HDR metadata and capability contracts exist, but
production HDR output is not yet certified and must not be inferred from API presence.

## Preview and playback

Canvas preview supports exact-time render, stale-request cancellation, adaptive/full quality,
fit/coordinate mapping, worker compositing, direct frame ownership, thumbnails, and statistics.
Player supplies play/pause/seek, AudioWorklet timing, bounded shared/transferable transport, video
scheduling, diagnostics, and cleanup.

## Audio

Supported paths include source decode, PCM mix, gain/fades, track mixing, playback timing,
waveforms/analysis, silence workflows, ducking/master settings, and WAV/RF64 export. Offline
analysis adds beat detection and audio-energy change candidates through
`SessionAudioController.analyzeBeats()` / `analyzeAudioEnergyChanges()`. The deprecated
`analyzeScenes()` alias inspects audio only and must not be presented as pixel-based video scene
detection. Exact encoded audio support is negotiated inside MP4/WebM profiles.

## Media input and cache

Production media supports File, URL/Range, OPFS, custom byte sources, MP4/MOV/MKV/TS/WebM indexing,
VideoFrame/PCM decode, AVIF/JPEG/PNG/WebP stills, proxy representations (including automatic proxy
registration through an injected encoder via `registerAutomaticProxy`), cache budgets, admission
queues, cancellation, and resource statistics. Large proxy sources require the range-reader
encoder contract; the legacy whole-buffer path fails above its configured memory limit. CDN
CORS/range correctness remains a deployment responsibility.

## Export

Profiles cover H.264/AAC, AV1/AAC, and HEVC/AAC MP4; VP9/Opus WebM; PNG/JPEG/WebP; GIF; and
WAV/RF64. Exact preflight checks codecs, color, channels, Materials, dimensions, and sink. Sinks
include bounded memory, OPFS, custom writable targets, checkpointed muxed export, and remote
providers.

## Materials

The SDK includes typed declarative graphs, Core Nodes, definitions/instances, deterministic
packages, integrity/signature/trust, catalog/registry, migrations, Material Lab, golden testing,
WebGL2/WebGPU compilation, budgets, and restricted trusted Shader/WASM policy. The WebGL2 and
WebGPU compilers share the full single-pass node set; multi-pass `blur.gaussian` graphs compile on
WebGL2 and fail closed on WebGPU (which lacks the multi-pass pipeline).

## Boundaries that are not universal promises

- Exact WebCodecs encoder/decoder configurations vary by browser, OS, hardware, and settings.
- WebGPU, OPFS, SharedArrayBuffer, AV1, HEVC, 4K, and HDR are capability-negotiated.
- Physical Safari/iOS/Android and broad real-device matrices need continuing certification.
- Long background jobs are constrained by page/mobile lifecycle; use remote export when durability
  must exceed it.
- The SDK is engine infrastructure, not a complete product UI, collaboration backend, asset
  service, or cloud renderer.

Run probes and export preflight on the actual target with representative media. See
[Compatibility and deployment](/AelionSDK/production/compatibility/) and
[Performance and resource budgets](/AelionSDK/production/performance/).
