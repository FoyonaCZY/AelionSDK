---
title: Check capabilities on the actual device
description: Choose preview, audio, storage, and export behavior from Session capability and exact preflight.
---

## Probe after opening

Run the Session capability probe once for the current page environment and loaded Project. It
reports API presence and usable backend/config results for codecs, workers, OffscreenCanvas,
WebGL2/WebGPU, AudioWorklet, shared-memory isolation, storage, streams, WASM, and color display.

Cache the report for the page/runtime identity, not forever on the user account. Browser updates,
headers, permissions, hardware, and power policy can change it.

## Preflight every export

Call `session.export.preflightProfile()` with the exact Project, profile, dimensions, frame rate,
bitrate, channels, color contract, materials, and sink immediately before starting. Generic codec
support or a previous job does not prove the current configuration.

## Turn issues into choices

Map stable issue codes to explicit options: lower resolution/rate, choose another profile, switch
from memory to OPFS, use a supported rendering backend, remove/replace an unsupported Material, or
send the job to a remote renderer.

Typical product handling:

- API/backend unavailable: disable the corresponding mode and explain the fallback.
- Exact codec config unsupported: keep the button discoverable, then offer compatible profiles.
- COOP/COEP missing: use the bounded transferable audio path and show the performance impact.
- OPFS unavailable: enforce a smaller memory limit or use a custom/remote sink.
- HDR/color contract unsupported: fail closed or require an explicit SDR conversion workflow.

Disable controls only when the current capability report is conclusive and no user input can
change it. Re-run checks after source, settings, permission, or output changes.

## Software codec fallback contract

When hardware codec support is absent, the SDK negotiates a software fallback through the
`CodecFallbackProvider` contract in `@aelionsdk/capability` (`CodecFallbackRegistry`,
`selectCodecExecution`). Register a backend (e.g. a WASM decoder) with
`codecFallbackRegistry.register(provider)`; the engine never ships a WASM backend in 1.1, so an
application chooses the codec strategy and supplies one. Negotiation picks hardware first, then the
first ready provider that `supports()` the codec identity, otherwise fails closed with
`CAPABILITY_CODEC_NO_BACKEND`. A `CAPABILITY_CODEC_FALLBACK_USED` diagnostic marks the lower
execution tier; preview and export semantics must stay identical across hardware and fallback
paths.
