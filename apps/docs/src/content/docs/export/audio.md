---
title: Export WAV audio
description: Write the mixed Sequence as s16 or f32 WAV and handle RF64 and large files.
---

Use the `audio-wav` profile to export the Sequence mix without video.

## Export to OPFS

Prefer `OpfsSeekableSink` for long audio. Preflight with the exact sink and sample format, start the
job, await both job completion and sink finalization, then obtain the resulting `File`.

## s16 or f32

- `s16` is smaller and broadly compatible for delivery and interchange.
- `f32` preserves floating-point samples for mastering and analysis workflows.

The Sequence sample rate and channel layout come from the frozen Project; they are not duplicated
as unrelated call-site settings.

## RF64

Classic RIFF/WAV uses 32-bit chunk sizes. When the output cannot be represented safely, the writer
uses the RF64 form and reports that choice in the result. Consumers must support RF64 for very long
or high-channel-count files.

## Encoded audio-only files

There is currently no standalone AAC or Opus audio profile. Those codecs are used inside MP4 and
WebM profiles. Choose WAV or integrate a remote/custom export path when an encoded audio-only
container is required.
