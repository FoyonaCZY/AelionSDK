---
title: Preview performance and resource budgets
description: Define measurable limits for decode, canvas, GPU, thumbnails, Materials, playback, and export.
---

## Measure real scenarios

Benchmark cold first frame, warm seek, rapid scrub, playback, multi-track composition, Material
load, thumbnails, waveform work, export throughput, cancellation, and a long edit session using
representative codecs, duration, resolution, frame rate, devices, and network.

Report latency distributions and terminal resource counts, not only an average FPS.

## Preview priorities

Cancel stale requests, use proxies, keep one main preview pipeline, lower interactive resolution,
bound decode-ahead and cache, reuse compiled IR/Materials, and avoid synchronous work in pointer
handlers. Review mode can trade latency for fidelity.

## Canvas pixels

CSS dimensions are not backing-store dimensions. Cap device-pixel-ratio scaling so a large display
does not accidentally multiply decode, texture, readback, and composite cost beyond the product
budget.

## Provider and Session budgets

Set hard limits for concurrent reads/decoders, queue length, compressed and decoded cache bytes,
frame ownership, GPU textures/contexts, pending preview work, thumbnail jobs, and export
concurrency. Admission should reject or wait for a bounded period, never grow without limit.

## Material and track cost

Track node count, graph depth, passes, texture samples, intermediate surfaces, input dimensions,
backend compilation, and per-frame time. Enforce static package budgets and runtime product tiers.

## Competing work

Export, proxy generation, analysis, waveform, thumbnails, and autosave must not all consume
unbounded CPU/GPU/I/O. Give interactive preview priority and expose a product scheduler for
background jobs.

## Statistics

Record first-frame/seek latency, render/decode time, dropped/cancelled frames, queue depth, audio
underruns, cache hit/bytes, GPU/backend state, export fps, written bytes, memory, and cleanup
outcome.

## Long-session acceptance

Repeat open/import/scrub/play/edit/export/cancel/switch/dispose cycles. After bounded cache settling,
workers, decoders, frames, contexts, listeners, timers, object URLs, and retained bytes must return
to the documented budget.
