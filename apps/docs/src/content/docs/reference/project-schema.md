---
title: Project schema reference
description: Immutable schema identities, migration, collections, relationships and validation.
---

Use `createProject()` or `createComposition()` for normal authoring. The current machine-readable
schema is [`schemas/project/v1.2/project.schema.json`](https://github.com/FoyonaCZY/AelionSDK/blob/main/schemas/project/v1.2/project.schema.json).

## Schema identities

| Dialect      | `$schema`                                      | `schemaVersion` | Purpose                                                    |
| ------------ | ---------------------------------------------- | --------------- | ---------------------------------------------------------- |
| Legacy v1.0  | `https://schemas.aelion.dev/project/v1.json`   | `1.0.0`         | Immutable schema published with 1.0                        |
| Current v1.2 | `https://schemas.aelion.dev/project/v1.2.json` | `1.2.0`         | Image sequences, caption cue settings and keyframe handles |

The 1.1/1.2 rc.1 packages accidentally emitted new fields with the legacy identity. The default
rc.2 validator recognizes that exact legacy identity, captures an ownership-isolated snapshot,
changes only the two identity fields, and validates the document against v1.2. It never mutates the
caller object. Use `migrateProjectToCurrent(value)` when the upgraded document should be persisted.
`defaultSchemas.legacyProject` remains available for strict v1.0 validation.

## Top-level model

| Field                                   | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `$schema`, `schemaVersion`, `projectId` | Protocol identity and stable Project identity                                                 |
| `metadata`, `settings`, `extensions`    | JSON-only product metadata, defaults and namespaced extensions                                |
| `assets`                                | Persistent media identities and representations; never `File`, credentials or decoder objects |
| `sequences`, `tracks`, `items`          | Normalized timeline graph and ordered ownership references                                    |
| `materialInstances`, `transitions`      | Effect instances and explicit transition ranges                                               |
| `markers`, `linkGroups`                 | Timeline annotations and AV/edit grouping                                                     |

Map keys must equal entity `id` values. Ordered ID lists cannot contain duplicates. Every reference
must resolve to an entity owned by the correct Sequence or Track.

## Time, color and media

Timeline and source timestamps are integer microseconds. Frame rate is rational. A Sequence owns the
canvas, sample rate, channel layout and explicit color contract. Media Items map Sequence time to an
Asset stream with linear or curve time maps and a declared boundary policy.

An `image-sequence` Asset contains `imageSequence.frameDurationUs` and ordered
`frameAssetIds`. Every referenced frame must be an existing `image` Asset. The compiler copies this
manifest into immutable Render IR, and preview/export resolve the same frame at every boundary.

Caption Items are owned by caption Tracks. SRT/WebVTT cue settings remain JSON data; advanced ASS
styling is not part of the current schema contract.

## Validation and loading

`loadProject()` performs bounded admission, schema validation, entity ownership and reference
checks, nested-sequence cycle checks, time-map semantics, transitions, masks, Material/audio/color
rules and image-sequence reference checks. Failure leaves the Session unchanged and returns stable,
path-aware diagnostics. A successful legacy migration is reported in
`ProjectValidationSuccess.migration`.
