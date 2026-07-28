---
title: Media representation, cache, and lifecycle
description: Understand assets, original and proxy representations, range reads, indexing, budgets, and cleanup.
---

## Asset and representation

An Asset is the persistent identity stored in Project JSON. A representation is a concrete source
for that identity: the original file, a proxy, or another compatible rendition. Representations
must describe duration and stream compatibility so the provider can reject a mismatched proxy
instead of changing timeline semantics.

The Project never stores `File`, handles, access tokens, decoders, or frames. Rebind those resources
when opening a project.

## Why range reads matter

MP4 and WebM indexing often needs bytes near both the start and end of a file. HTTP sources should
support `Range`, `Content-Range`, and CORS. A bounded full-download fallback is suitable only for
small files. Large non-seekable responses should fail clearly.

## What SampleIndex provides

The provider turns container metadata into stable sample timing, keyframe, size, and physical byte
location information where the container exposes it. Seeking starts from a valid decode point and
decodes forward; normalized timestamps must not be presented as raw DTS or physical offsets.

## Provider budgets

`ProductionMediaProvider` limits concurrent I/O, decoders, queued work, cached bytes, decoded
frames, and GPU admission. A single request cannot exceed the page budget, and a full admission
queue fails rather than growing without limit. Product code should cancel obsolete thumbnail and
scrub requests.

## Frame ownership

The component that receives a `VideoFrame` owns it until it transfers ownership or calls `close()`.
Cached frames, worker replies, preview callbacks, and encoder submissions each need an explicit
terminal path for success, cancellation, error, and disposal.

## Recommended cleanup order

1. Stop product requests and abort background work.
2. Dispose preview controllers and frame subscribers.
3. Stop and dispose the player.
4. Cancel or await exports and finalize or clean their sinks.
5. Dispose the Session.
6. Revoke object URLs and dispose the media provider.

Use [Importing and managing media](/AelionSDK/guides/media-import/) for registration examples and
[Performance and resource budgets](/AelionSDK/production/performance/) for long-session acceptance.
