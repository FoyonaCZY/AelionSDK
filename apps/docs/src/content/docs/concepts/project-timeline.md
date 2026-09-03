---
title: Project and timeline data
description: Understand Sequence, Track, Item, Asset, Link Group, Marker, and time mapping in Project v2.
---

## What a Project contains

Project v2 is normalized JSON: entity maps hold values and ordered ID arrays define presentation
order. References are validated on load, so missing, duplicated, cyclic, cross-owner, or
host-mismatched entities fail before execution.

## Sequence defines the output space

A Sequence owns canvas size, rational frame rate, sample rate, duration, color contract, track
order, and output settings. A Project can contain multiple sequences; nested sequence items refer
to another sequence but cycles are rejected.

## Tracks contain Items

Visual, audio, and caption tracks control order, visibility, lock state, and mixer behavior. Items
carry actual timed content. Visual items may reference media, text, shapes, nested sequences,
materials, masks, animation, or transitions; audio items reference source ranges and mixer data.

A Track can be an `overlay` with free occupancy or the Sequence's single `storyline`, whose
exclusive occupancy is packed by the timeline planner. A Sequence may contain at most one
storyline Track. Explicit Transition pairs may overlap on an exclusive Track; other overlaps are
rejected. A `gap` Item reserves intentional empty time without rendering content.

## Timeline time and source time

`startUs` and `durationUs` place an Item on the timeline. Its source range and time map determine
which part of the asset is evaluated. Moving an Item changes timeline placement; trimming, slip,
rate, or curve mapping may also change source evaluation. Ranges are half-open.

## Assets do not contain File objects

Assets persist identities and representation metadata. A media provider reconnects those identities
to user-selected files, authenticated URLs, OPFS entries, or custom sources at runtime.

## Link groups and markers

Link groups keep related visual and audio items synchronized for commands that opt into linked
editing. Markers annotate sequence or item time without rendering into the output.

## Build instead of hand-writing JSON

Use `createProject()` for media-oriented construction or `createComposition()` for product-level
creative authoring. Both produce the same Project v2 format and pass the same validator.

See [Project v2 field reference](/AelionSDK/reference/project-schema/) for exact fields and
[Timeline editing](/AelionSDK/guides/timeline-editing/) for commands.
