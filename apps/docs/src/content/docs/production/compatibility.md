---
title: Browser compatibility and deployment
description: Understand the tested matrix, HTTPS, isolation headers, media CDN, workers, and platform limits.
---

## Status vocabulary

**Automated** means a checked repository workflow. **Supported** means the public capability and
fallback contract is implemented. **Certified** requires the documented physical-device and
long-session evidence. An API existing in a browser is not the same as an exact configuration
passing preflight.

## Current automated coverage

The repository runs type, unit, schema, API, package, Chromium browser, Firefox browser, and
documentation gates. Playwright WebKit/mobile viewports cover public fallback contracts; physical
Safari, iOS, Android, device codec matrices, and production HDR certification remain separate
evidence work.

The current RC local color contract is RGBA8 SDR. Treat AV1, HEVC, 4K, WebGPU, HDR, OPFS, and
hardware codec combinations as negotiated capabilities.

## HTTPS

Deploy production applications and media over HTTPS. Service workers, secure storage, worklets,
cross-origin isolation, and several media primitives have secure-context requirements.

## COOP and COEP

For the preferred shared-memory audio path:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Every embedded script, worker, font, image, and media response must also satisfy CORS/CORP. When
isolation is unavailable, use the documented bounded fallback rather than assuming
`SharedArrayBuffer`.

## Media CDN

Serve correct MIME and length, support `Range`/`Content-Range`, allow the application origin, and
define credential behavior. Test seek near the end of a large file, not only initial playback.

## Worker, Worklet, and CSP

Deploy the renderer worker, export worker, and AudioWorklet as explicit runtime assets. Configure
`worker-src`, `script-src`, `connect-src`, `media-src`, `img-src`, and font rules narrowly. Do not
enable arbitrary remote scripts to make a worker load.

## 4K, mobile, and HDR

Use real-device preflight and budgets. Mobile backgrounding, thermal throttling, memory pressure,
screen lock, and browser lifecycle can end long jobs. HDR requires compatible Project metadata,
working space, renderer, surface, encoder, container, display, and validation; never silently
present SDR as certified HDR.
