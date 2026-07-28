---
title: Why preview and export should agree
description: Understand shared Render IR, proxy media, adaptive preview quality, and frozen export revisions.
---

## After Project load

The Session validates Project JSON and compiles an immutable Render IR containing resolved timing,
layer order, source evaluation, materials, color, and audio rules. The same IR semantics feed
preview, playback, local export, and the payload for remote export.

## Rules that must be shared

Item visibility, source mapping, transforms, opacity, masks, effects, transitions, nested
sequences, color conversion, channel layout, gain, fades, and master settings must not have
independent preview-only and export-only interpretations.

## Preview may trade quality for latency

Preview can select a proxy representation, reduce output scale, skip an obsolete frame, lower
material quality, or use adaptive scheduling. Those choices may reduce fidelity, but the requested
timeline time and composition semantics stay unchanged. Review mode should use full quality when
visual sign-off matters.

## Export freezes the starting revision

An export job captures the current revision and IR before preflight. Later edits create a new
revision and do not mutate the running job. A revision mismatch is an error, not a request to blend
old and new state.

## Remote parity

Send canonical Project data, exact material identities, media identities, engine/protocol versions,
and the frozen revision to the service. The server must validate again and resolve the same assets
and materials. Do not treat an arbitrary checkpoint as trusted executable state.

## Product verification

Maintain golden projects covering time maps, transitions, materials, text, masks, color, and audio.
Compare selected review frames and measurable audio output between preview and export, while
allowing only documented encoder and preview-quality tolerances.
