---
title: Time, frame rate, and source time
description: Use integer microseconds, rational frame rates, half-open ranges, and explicit source mapping.
---

## Use time helpers

Timeline values are non-negative safe integer microseconds. Prefer `seconds()`, `milliseconds()`,
`frames()`, and the rational conversion helpers instead of scattering `* 1e6` arithmetic across
product code.

## Why not floating-point seconds

Repeated floating-point conversion accumulates rounding error and makes frame boundaries,
comparison, serialization, undo, and cross-runtime evaluation unstable. A rational frame rate
keeps rates such as 30000/1001 exact.

```ts
const film = { numerator: 24, denominator: 1 };
const ntsc = { numerator: 30_000, denominator: 1_001 };
```

## Half-open ranges

Time ranges use `[startUs, startUs + durationUs)`. Adjacent clips can share a boundary without both
claiming the same instant. Split, trim, transition, and marker logic should follow the same rule.

## Timeline time is not source time

An Item maps a timeline interval to an asset source interval. Move changes timeline placement;
slip changes the source window; rate and curve maps change the relationship between the two.
Current pitch-preserving audio accepts the documented linear mapping only; unsupported nonlinear
combinations fail explicitly.

## UI snapping is a product policy

The SDK validates exact command inputs but does not decide whether the UI snaps to frames, markers,
clip edges, beats, or guides. Convert pointer positions into microseconds, apply product snapping,
then submit a semantic command.

Before submitting, verify safe-integer time, non-negative duration, an interior split/trim point,
available source handles, and the current revision.
