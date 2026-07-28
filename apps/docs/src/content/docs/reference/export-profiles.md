---
title: Export Profiles quick reference
description: Reference profile IDs, codecs, MIME types, extensions, options, and result behavior.
---

| ID              | Kind           | MIME         | Extension | Video          | Audio  |
| --------------- | -------------- | ------------ | --------- | -------------- | ------ |
| `webm-vp9-opus` | muxed A/V      | `video/webm` | `.webm`   | VP9            | Opus   |
| `mp4-h264-aac`  | muxed A/V      | `video/mp4`  | `.mp4`    | negotiated AVC | AAC-LC |
| `mp4-av1-aac`   | muxed A/V      | `video/mp4`  | `.mp4`    | AV1            | AAC-LC |
| `mp4-hevc-aac`  | muxed A/V      | `video/mp4`  | `.mp4`    | HEVC           | AAC-LC |
| `still-png`     | still          | `image/png`  | `.png`    | —              | —      |
| `still-jpeg`    | still          | `image/jpeg` | `.jpg`    | —              | —      |
| `still-webp`    | still          | `image/webp` | `.webp`   | —              | —      |
| `animated-gif`  | animated image | `image/gif`  | `.gif`    | —              | —      |
| `audio-wav`     | audio          | `audio/wav`  | `.wav`    | —              | PCM    |

All local profiles accept a sink, optional `AbortSignal`, optional `cleanupSink`, and progress
callback. MP4/WebM add video/audio bitrate; WAV adds `sampleFormat: 's16' | 'f32'`; still images add
`timeUs` and optional quality; GIF adds optional `loopCount`.

Session supplies duration, dimensions, rational frame rate, sample rate, channels, color, and
frozen IR from the Project.

Results contain MIME, frame/sample counts, duration, actual encoder configuration where relevant,
written bytes, and format-specific metadata. File bytes remain in the sink.

`probeExportProfiles()` checks generic requested configurations. `session.export.preflightProfile()`
also checks the loaded Project, channel/color/Material constraints, sink, and runtime AAC canary.
AV1/HEVC appearing in this table does not imply device support.

`exportResumableMuxed()` implements checkpointed committed units for muxed profiles. Normal Session
jobs are one-shot unless the application explicitly uses that API.
