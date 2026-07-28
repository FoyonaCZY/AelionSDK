---
title: Error handling, recovery, and logs
description: Handle diagnostics, cancellation, revision conflict, runtime failure, and refresh recovery.
---

## One error boundary

Normalize SDK `AelionError` diagnostics, standard argument/lifecycle errors, `AbortError`, remote
provider errors, and product/network errors into one task model. Branch on stable `code`, severity,
recoverability, and structured fields; never parse English messages.

## Session diagnostics

Subscribe to `diagnostic` events for asynchronous renderer, player, media, Material, and export
problems. Include the corresponding revision, entity/range/path, backend, and task identity when
displaying or logging them.

## Retry policy

Retry only after changing the condition: renewed authorization, restored network, freed storage,
lowered output settings, rebuilt a lost renderer, reconnected media, or refreshed a stale revision.
Invalid Project/schema, unsupported semantics, integrity failure, or deterministic budget rejection
should not loop.

## Revision conflict

Cancel optimistic UI, read the newest snapshot, reconstruct the user intent at the new revision,
and ask for confirmation if the target or meaning changed. Do not replay stale low-level operations.

## Renderer or Player failure

Stop presenting stale output, release the failed runtime, preserve the committed Project, probe
capabilities again, and create/load a new Session where recovery is supported. Report any degraded
backend or audio mode.

## Refresh recovery

Persist Project snapshots by revision, product asset locators, durable remote job IDs, and resumable
export checkpoints. Never persist live workers, frames, credentials, object URLs, or assumed
decoder state.

## Events plus statistics

Events explain lifecycle transitions; statistics explain trends before a failure. Correlate them
with a short-lived task/session ID without creating a cross-session device fingerprint.

Log versions, revision, code/severity/recoverable, stage, safe codec/backend settings, and cleanup
result. Do not log URL tokens, user media, Project text, or complete custom shader sources.
