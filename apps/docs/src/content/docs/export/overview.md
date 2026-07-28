---
title: Choose an export format
description: Select MP4, WebM, images, GIF, WAV, local export, or a remote renderer.
---

## Start with the delivery target

| Target                                            | Recommended profile                        |
| ------------------------------------------------- | ------------------------------------------ |
| Broad web and desktop video delivery              | `mp4-h264-aac`                             |
| Open web delivery                                 | `webm-vp9-opus`                            |
| AV1 or HEVC workflow with verified device support | `mp4-av1-aac` or `mp4-hevc-aac`            |
| Thumbnail or poster                               | `still-png`, `still-jpeg`, or `still-webp` |
| Short looping preview                             | `animated-gif`                             |
| Uncompressed mixed audio                          | `audio-wav`                                |

Profiles express intent; support is negotiated on the actual device and Project.

## Complete local flow

1. Choose a profile and output sink.
2. Call `session.export.preflightProfile()` with the exact options.
3. Present warnings, alternatives, estimated size, and storage requirements.
4. Start the job, subscribe to progress, and expose cancellation.
5. Await job completion and the sink's finalization.
6. Download, retain, or clean up the completed file.

The running job freezes the current Project revision. A later edit does not alter it.

## Sink selection

Use a memory sink for small outputs that must immediately become a Blob. Use `OpfsSeekableSink` or
a custom seekable sink for long output, bounded memory, and resumable segments. A sink owns bytes;
the job result contains metadata, not another full copy.

## Local or remote

Local export offers privacy, no upload, and instant feedback, but depends on browser codecs,
storage, memory, battery, and page lifetime. Remote export is appropriate for unsupported codecs,
large collaborative jobs, server fonts/materials, mobile limits, or background completion. It
requires explicit authorization, asset resolution, validation, progress, cancellation, and result
retention.

See [Export profiles](/AelionSDK/reference/export-profiles/),
[Job and sink lifecycle](/AelionSDK/export/jobs-sinks/), and
[Remote export](/AelionSDK/export/remote/).
