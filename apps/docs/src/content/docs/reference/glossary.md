---
title: Glossary
description: Short definitions for common AelionSDK Project, timeline, media, rendering, Material, and export terms.
---

## Project and timeline

- **Project** — canonical persistent JSON describing what to edit.
- **Sequence** — an output timeline with canvas, time, audio, and ordered tracks.
- **Track** — ordered container for compatible Items.
- **Item** — timed visual, audio, caption, transition, or nested content.
- **Asset** — persistent media identity, separate from runtime bytes.
- **Representation** — original, proxy, or compatible rendition of an Asset.
- **Link Group** — Items intended to participate in linked editing.
- **Marker** — non-rendering time annotation.

## Time and editing

- **Timeline time** — placement in a Sequence, stored as integer microseconds.
- **Source time** — position inside original media.
- **Time map** — mapping from Item-local/timeline time to source evaluation.
- **Revision** — monotonically increasing committed Project version.
- **Transaction** — atomic candidate edit validated before commit.
- **History group** — several interaction updates represented by one undo entry.

## Execution

- **Session** — runtime owner for Project, editing, preview, playback, export, and diagnostics.
- **Render IR** — immutable resolved audio/visual execution graph shared by preview and export.
- **Preview** — latency-oriented evaluation at requested timeline time.
- **Player** — timed playback using audio clock when audio is active.
- **Capability report** — usable environment/backend/config observations.
- **Preflight** — exact validation of a requested operation before starting it.

## Media, Materials, and export

- **Media Provider** — runtime binding from Asset ID to bytes/index/decode.
- **SampleIndex** — container-derived sample timing/keyframe/byte-location data.
- **Material Definition** — reusable typed visual behavior and metadata.
- **Material Instance** — Project-owned parameter/resource/input bindings to a Definition.
- **Material Package** — deterministic manifest and payload with integrity identity.
- **Sink** — caller-owned output destination.
- **Export profile** — stable format intent such as `mp4-h264-aac`.
- **Remote provider** — application service adapter for durable server-side rendering.
