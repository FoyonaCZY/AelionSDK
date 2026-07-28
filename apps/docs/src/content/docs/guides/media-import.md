---
title: Import and manage media
description: Bind File, URL, OPFS, and proxy media to Project assets and handle reauthorization.
---

## Choose by source

| Source                       | Registration approach                                   |
| ---------------------------- | ------------------------------------------------------- |
| User-selected local file     | `registerFile()`                                        |
| HTTP/CDN media               | URL/range registration with explicit credentials policy |
| OPFS media                   | OPFS file or handle registration                        |
| Custom authenticated storage | custom byte source/provider adapter                     |
| Preview proxy                | representation paired with the original asset           |

Create one `ProductionMediaProvider` per editor runtime so indexing, decoder admission, cache
budgets, proxies, and cancellation are coordinated.

## Import a File

Register the selected File under a stable asset ID, call `probe()`, choose compatible video/audio
tracks, then use `ProjectBuilder.importMedia()` or the Composition API to add the desired source
range at a timeline position. Do not place the `File` inside Project JSON.

## URL and CDN requirements

Use HTTPS and configure CORS for the application origin. Large media needs byte-range support and
correct `Content-Range`. Decide whether credentials are omitted, cookie-based, or supplied by a
short-lived application adapter; never persist bearer tokens in the Project.

## Proxies

Register a lower-cost representation for interactive preview while preserving asset identity,
duration, and source-time mapping. If duration or compatibility checks fail, reject the proxy and
fall back to the original. Export normally resolves the original representation.

## OPFS

OPFS is suitable for durable local imports, generated proxies, and large outputs. Store a product
locator or logical key in application metadata, reopen the file, and re-register it when restoring
the project.

## Manual tracks and items

Use manual construction only when the product must choose tracks, link behavior, source windows,
or timing that automatic import cannot infer. Keep visual/audio items linked when they came from
the same media and the UI promises linked editing.

## Switching projects

Abort probes, thumbnails, and reads; dispose preview and Session; release decoder/cache resources;
revoke object URLs; then dispose or reuse the provider according to its ownership contract.

Common failures are represented by stable `MEDIA_*` diagnostics. See
[Troubleshooting](/AelionSDK/production/troubleshooting/) and
[Media lifecycle](/AelionSDK/concepts/media-lifecycle/).
