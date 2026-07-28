---
title: Export still images and GIF
description: Save PNG, JPEG, or WebP at a timeline position, or render a looping GIF.
---

## Still images

Choose `still-png`, `still-jpeg`, or `still-webp`, provide `timeUs`, a sink, and an optional quality
for lossy formats, then run exact preflight. The frame uses the same frozen Render IR and timeline
evaluation as video export.

PNG is suitable for lossless UI and transparency. JPEG is broadly supported for opaque photos.
WebP offers another lossy or lossless delivery choice when the target supports it.

## Download

For small files, finalize a memory sink, create a Blob from the returned bytes and MIME type,
download it, and revoke the object URL. For batch generation, use OPFS or a custom sink to avoid
holding every result in memory.

## GIF

`animated-gif` renders the Sequence as a looping image and accepts `loopCount`. GIF has a limited
palette and no audio; it is intended for short previews, not a replacement for normal video.
Preflight still checks canvas, dimensions, frame count, storage, and material execution.

Cancellation or failure must clean the partial sink before retrying.
