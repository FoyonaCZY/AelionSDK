---
title: Export jobs, progress, and file sinks
description: Manage cancellable jobs, Memory and OPFS sinks, and partial-output cleanup.
---

## Connect a Job to task UI

An export job has a stable lifecycle: queued/preparing, running, cancelling, completed, failed, or
cancelled. Subscribe to structured progress and diagnostics; do not infer completion from a
progress percentage. Await the terminal promise.

## Cancellation

Call `job.cancel()` or abort the supplied signal, then await the terminal state. Cancellation is
expected control flow. Product UI should distinguish it from a failed encode or storage error.

## Memory cost

A memory sink accumulates the complete output and may create additional copies when finalized,
wrapped in a Blob, or downloaded. Reserve it for bounded output and enforce a product size limit.

## OPFS finalization

With `OpfsSeekableSink`, await the export job, call or await `waitUntilFinalized()`, and only then
obtain the completed file. Job completion means the producer finished; sink finalization confirms
the durable file state.

## Custom sink contract

A seekable sink must provide deterministic write, seek/position, truncate/finalize, error
propagation, and exclusive ownership behavior required by the muxer. Do not allow concurrent
writers to the same target.

## Cleanup is required

Pass `cleanupSink` whenever a failed or cancelled task can leave a partial file, OPFS entry,
multipart upload, or remote allocation. Cleanup must be idempotent. Keep a completed output only
after both the job and sink report success.

For checkpointed muxed output, persist the application job identity and committed-unit manifest;
never resume bytes against a different Project/material/media identity.
