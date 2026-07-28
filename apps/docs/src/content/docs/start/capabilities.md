---
title: Capabilities and limits
description: Current browser editing, rendering, audio and export support plus known boundaries.
---

## Supported today

- Multi-track timeline editing with linked audio/video, markers, keyframes, speed changes and undo/redo.
- Canvas preview and playback with WebGL2/WebGPU worker composition and AudioWorklet audio timing.
- MP4/WebM indexing, HTTP Range access, proxy media, cache budgets and deterministic resource cleanup.
- H.264/AV1/HEVC + AAC MP4, VP9/Opus WebM, PNG/JPEG/WebP, GIF and WAV/RF64 export when preflight passes.
- Project snapshots, IndexedDB recovery, custom Materials, isolated Worker RPC and remote export providers.

## Known boundaries

The `1.0.0-rc.1` release is not yet a stable API. Automated Chromium, Firefox, Playwright WebKit and mobile viewport coverage is present, but physical Safari, iOS and Android devices are not certified. Local composition is RGBA8 SDR; HDR, PQ/HLG and 10-bit output are not supported. 4K export is supported as a capability-gated path, not a cross-device real-time preview promise.

Run capability probes and export preflight on the actual device and with representative media. See [compatibility and deployment](/AelionSDK/production/compatibility/) and the [performance baseline](/AelionSDK/production/performance/).
