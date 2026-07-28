---
title: Session events, snapshots, and statistics
description: Understand commit timing, consistent snapshots, and Preview, Player, Export, and resource telemetry.
---

## Event overview

| Event family        | Emitted for                                                    |
| ------------------- | -------------------------------------------------------------- |
| Project/load        | load start, committed replacement, load failure                |
| Commit/history      | edit commit, undo, redo, interaction-group transition          |
| Diagnostic          | asynchronous structured warning/error/fatal condition          |
| Preview             | frame result, cancellation/drop, backend or quality transition |
| Player              | ready/play/pause/seek/end/error and transport changes          |
| Export              | job state, progress, diagnostic, terminal result               |
| Capability/resource | probe changes and bounded resource transitions                 |

## Commit consistency

A commit observer runs after the new Project and revision are installed. The event's revision/change
set and `session.getSnapshot()` refer to that committed state. Do not start a re-entrant transaction
inside synchronous preparation/observer code.

## Snapshot

`getSnapshot()` returns an immutable view of Project, revision, history availability, and relevant
Session state. Treat it as a read model; submit changes through commands/transactions.

## Preview statistics

Requested, rendered, cancelled, dropped, queue depth, decode/render duration, scale/quality,
backend, and owned resource counts.

## Player statistics

State/time, audio transport, underruns, queue fill, clock drift, scheduled/dropped visual frames,
and runtime failure.

## Export statistics

Job/profile/stage, progress, rendered/encoded frames, duration, throughput, bytes written,
checkpoint/finalization, cancellation, cleanup, and diagnostic.

## Telemetry

Correlate events and stats with short-lived session/job IDs and versions. Avoid credentials,
media content, Project text, complete shader source, and stable cross-session device fingerprints.
