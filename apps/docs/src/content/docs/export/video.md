---
title: Export MP4 and WebM
description: Configure H.264/AAC, AV1/AAC, HEVC/AAC, or VP9/Opus output and bounded file storage.
---

## H.264/AAC MP4

Choose `mp4-h264-aac` for the broadest delivery compatibility. Aelion probes an exact AVC
configuration and runs the AAC runtime canary during preflight. API availability alone is not proof
that the selected resolution, rate, profile, level, and audio settings can encode.

## AV1/AAC and HEVC/AAC MP4

`mp4-av1-aac` and `mp4-hevc-aac` are explicit opt-in profiles. They remain visible in the API even
when unsupported so products can present deterministic alternatives. Never silently relabel or
transcode an unsupported choice as H.264.

## VP9/Opus WebM

Choose `webm-vp9-opus` for an open web stack. Preflight checks both the requested VP9 video config
and Opus audio path.

## Bitrate and dimensions

Start with a product preset based on pixel count, frame rate, motion, content, and delivery
constraints, then let users trade quality for size. Do not infer support from bitrate alone.
Preflight the exact width, height, frame rate, bitrate, channel layout, color contract, and
materials.

## 4K boundaries

4K is a capability result, not a universal promise. GPU texture limits, encoder limits, memory,
storage, and thermal behavior all matter. Offer a lower-resolution fallback when exact preflight
does not pass.

## Long output and resume

Write long files to OPFS or another seekable sink. `exportResumableMuxed()` checkpoints committed
segments under an application job ID and resumes only uncommitted units. A normal
`session.export.startProfile()` job is intentionally one-shot.

## Memory output

For short exports, finalize a memory sink, create a Blob with the reported MIME type, trigger a
download, revoke the object URL, and release the byte buffer as soon as the product no longer needs
it. See [Export jobs and sinks](/AelionSDK/export/jobs-sinks/).
