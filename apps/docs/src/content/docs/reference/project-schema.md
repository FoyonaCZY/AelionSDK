---
title: Project v1 field reference
description: Reference top-level collections, IDs, Sequence, Track, Item, Asset, and load validation.
---

The machine-readable definition is `schemas/project/v1/project.schema.json`. Use `createProject()`
or `createComposition()` for normal authoring.

## Top-level fields

Project v1 contains protocol/schema identity, project ID and metadata, settings, normalized maps for
assets/sequences/tracks/items/material instances/link groups/markers, and ordered root references.
Every persisted value is canonical JSON.

## Entity IDs

IDs are stable non-empty identifiers. A normalized map key must equal the entity's own `id`.
Ordered ID lists cannot contain duplicates, and every reference must resolve to an entity owned by
the correct host.

## Settings

Settings hold Project-wide execution and product-compatible defaults such as main sequence,
working color/audio policy, and extension data allowed by the schema. Runtime objects and secrets
are forbidden.

## Sequence

A Sequence defines canvas width/height, rational frame rate, sample rate, duration, color contract,
ordered track IDs, and sequence-scoped markers/material data. Nested sequence references cannot
form a cycle.

## Track

Tracks belong to exactly one Sequence and have a compatible kind, ordered item IDs, lock/visibility
state, and audio mixer fields where applicable. An Item cannot be owned by multiple tracks.

## Item common fields

Items have ID, host track, kind, timeline `startUs`/`durationUs`, source mapping where relevant,
enabled state, and kind-specific content. Visual items may carry transforms, crop/mask, opacity,
animation, effects, and transitions; audio items carry media/source and mix behavior.

## Assets and relationships

Assets describe persistent media identity and representations, never `File` or credentials.
An `image-sequence` Asset carries an optional `imageSequence` frame manifest
(`frameDurationUs` + ordered `frameAssetIds`) referencing `image` Assets; each frame reference must
resolve to an existing `image` Asset or validation fails closed with
`PROJECT_IMAGE_SEQUENCE_FRAME_MISSING` / `PROJECT_IMAGE_SEQUENCE_FRAME_KIND_INVALID`.
Transitions bind compatible visual hosts over non-overlapping valid ranges. Link groups bind
co-edited items. Markers annotate sequence/item time without rendering.

## `loadProject()`

Load performs bounded structural admission, canonical clone/number checks, JSON Schema validation,
entity/reference/ownership checks, time and mapping validation, transition/mask/material/audio/color
rules, migration compatibility, and Render IR compilation. Failure leaves the Session unchanged
and returns structured diagnostics with path/entity/range context.
