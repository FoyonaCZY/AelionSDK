---
title: Author with the Composition API
description: Create images, text, shapes, captions, effects, masks, keyframes, and transitions.
---

The Composition API is the product-level authoring surface. It produces the same Project v1 used
by media import, Session, persistence, preview, and export.

## Create a Composition

Create a composition with a stable ID, canvas size, rational frame rate, sample rate, and duration.
Add ordered visual, audio, and caption layers. Use the time helpers for every placement and
duration.

## Add content

Clips can describe imported media, images, styled text, vector shapes, captions, solid/generated
content, and nested sequences. Visual properties include transform, opacity, crop/mask, blend
behavior, animation, and enabled effects. Audio clips carry source mapping, gain, fades, and mixer
relationships.

## Reuse Materials and transitions

Reference installed Materials by exact package/definition identity and provide validated parameter
values and resource bindings. An effect belongs to its host item; a transition binds two compatible
visual inputs over a valid interval.

## Build and load

`build()` creates a plain Project and validates the authored structure. Bind its asset IDs to a
media provider, create a Session, and call `loadProject()`. The Session performs the full untrusted
input, reference, time, ownership, Material, and execution validation.

## `advanced()`

Use the advanced escape hatch only for Project features not yet represented by the high-level
builder. Keep IDs and ownership stable, return canonical JSON, and treat validation failure as a
construction error. Do not use it to bypass semantic commands during interactive editing.

Continue with [Importing media](/AelionSDK/guides/media-import/) and
[Timeline editing](/AelionSDK/guides/timeline-editing/).
