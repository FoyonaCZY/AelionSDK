---
title: Transactions, revisions, and undo
description: Make atomic Project edits, merge interaction history, and recover from revision conflicts.
---

## Prefer semantic commands

Use `session.commands` for move, trim, split, ripple, roll, slip, slide, track, marker, and linked
editing. Commands enforce ownership, transitions, source handles, track compatibility, and time
mapping rules that generic field mutation cannot infer.

## Change several fields atomically

A transaction prepares a candidate Project and commits only after all operations and full Project
validation succeed. If any operation fails, the Project, revision, events, and history remain
unchanged.

## Revision

Every commit increments a monotonically increasing revision. A command prepared against an older
`baseRevision` fails with `REVISION_CONFLICT`; read the latest snapshot and rebuild the user intent
instead of replaying stale low-level operations.

## Undo and redo

History records validated changes and applies inverse changes through the same engine. Product UI
should read `canUndo` and `canRedo`; an empty or externally diverged history fails explicitly.

## One undo entry per drag

Open an interaction history group at pointer-down, submit intermediate validated edits while
dragging, and commit or cancel the group at pointer-up. Keep transient pointer state in the UI, not
inside Project JSON.

## Subscribe after commit

Commit events include the new revision and change set. Reading `session.getSnapshot()` from the
observer returns the corresponding committed Project. Avoid re-entrant edits from synchronous
transaction or history callbacks.

On failure, cancel optimistic UI, read the latest snapshot, and map the stable diagnostic `code` to
a product message. See [Diagnostic codes](/AelionSDK/reference/diagnostic-codes/).
