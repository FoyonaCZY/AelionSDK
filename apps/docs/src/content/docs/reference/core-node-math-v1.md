---
title: Core Node Math 1.0.0
description: Reference Material Core Node formulas, color/alpha assumptions, and golden tolerances.
---

Core Nodes operate on typed values under the Material execution contract. Scalar/vector arithmetic
is component-wise where defined. Division, normalization, power, interpolation, clamp, smoothstep,
matrix/transform, UV, time/progress, and noise nodes follow the versioned definitions in the
machine-readable Core Node set; invalid type or unsupported version fails graph validation.

## Math and time

- `mix(a, b, t) = a * (1 - t) + b * t`.
- `clamp(x, lo, hi)` applies the declared scalar/vector bounds.
- `smoothstep(e0, e1, x)` uses the normalized clamped Hermite curve.
- Timeline, local item time, normalized progress, frame, and pixel/UV values are explicit system
  bindings; a graph must not infer them from wall-clock time.
- Deterministic noise uses declared seed and coordinate inputs.

## Color and composition

Core color operations consume the execution contract's declared working space and alpha form.
Sampling obeys normalized UV, filter, and boundary rules. Premultiply/unpremultiply, opacity, blend,
mask, and transition nodes cannot silently switch between straight and premultiplied alpha.

## Golden tolerance

Golden tests declare backend, dimensions, color/alpha contract, input identity, parameter values,
and expected output. Exact integer/canonical metadata is compared exactly; visual output uses the
protocol's per-channel/aggregate tolerance appropriate to the certified backend. A performance hint
never changes semantic tolerance.

The authoritative formula and node-version data is exported by the Material compiler package and
is validated by Material Lab/golden tooling.
