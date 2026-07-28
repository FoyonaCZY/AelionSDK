---
title: Editing Commands quick reference
description: Find command intent, shared options, result behavior, and common rejection reasons.
---

Commands operate on stable IDs and a current base revision. Successful commands return the
committed revision/change information; failure is atomic.

## Item commands

| Command family     | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| add/remove/replace | create or remove supported item topology           |
| move               | change start, track, and ordering                  |
| trim               | move an in/out edge while preserving valid mapping |
| split              | partition an item at an interior timeline time     |
| ripple             | edit and shift the affected range                  |
| slip               | keep placement and move the source window          |
| roll               | move the edit point between adjacent items         |
| slide              | move an item while adjusting both neighbors        |

Shared options include `baseRevision`, linked-edit scope, target track/order anchor, history
interaction identity, and command-specific IDs/times.

## Link groups

Create/remove a link group, add/remove members, and explicitly choose whether item commands affect
linked members. Commands reject cross-sequence, duplicate, missing, or nondeterministically mapped
members.

## Professional trim constraints

Trim/ripple/roll/slip/slide require compatible track ownership, unlocked targets, source handles,
valid half-open ranges, supported time mapping, and a deterministic transition/animation/owned-data
policy.

## Track commands

Add/remove/reorder tracks; change lock and visibility; and set mute/solo/mixer state on audio
tracks. A locked target rejects item mutation rather than allowing a generic field bypass.

## Markers and selection metadata

Marker commands add, move, update, or remove sequence/item annotations. Product selection remains
view state unless stored in the schema's explicit metadata contract.

## Failure guarantee

Common diagnostics include `REVISION_CONFLICT`, `COMMAND_NO_CHANGE`, missing/locked/incompatible
track or item, invalid time/range/anchor, unavailable source handle, transition conflict, and
unsupported ownership/time mapping. No failed command mutates Project, revision, events, or history.
