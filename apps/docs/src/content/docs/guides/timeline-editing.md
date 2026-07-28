---
title: Timeline editing
description: Connect move, trim, split, linked editing, and drag gestures to semantic commands.
---

## Read from the current Project

Render timeline rows from `session.getSnapshot()` and stable entity IDs. Commands should be
prepared against the current revision, not a stale component copy.

## Core item commands

- **Move** changes timeline placement and optionally track/order.
- **Trim** changes an edge while preserving valid source mapping and transitions.
- **Split** creates a right-hand item at an interior time and partitions supported owned data.
- **Slip** keeps placement but moves the source window.
- **Ripple** shifts affected neighbors according to the command scope.
- **Roll** moves a shared edit point between neighbors.
- **Slide** moves an item while adjusting adjacent boundaries.

Commands reject missing source handles, unsupported nonlinear mapping, locked/incompatible tracks,
transition conflicts, and owned data without a deterministic policy.

## Linked A/V

Imported video and audio may share a link group. Pass the linked-edit option when the product
promises synchronized behavior. Explicit unlink is preferable to silently editing only one member.

## Tracks and markers

Use track commands for add/remove/reorder, visibility, lock, mute, and solo behavior. Markers are
non-rendering time annotations and can be sequence- or item-scoped.

## Smooth drag behavior

Keep pointer state and the proposed position in view state. Open one history interaction group,
throttle/coalesce command submission, reject stale results, and commit or cancel the group at
pointer-up. Do not create one undo entry per pointer event.

## Refresh after commits

Subscribe to committed change sets, read the matching snapshot, update normalized selectors, and
invalidate only affected thumbnails/waveforms. Map stable `COMMAND_*` and `REVISION_CONFLICT`
diagnostics to actionable UI.

Exact parameters and return values are listed in
[Editing Commands](/AelionSDK/reference/editing-commands/).
