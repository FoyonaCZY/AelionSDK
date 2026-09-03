# AelionSDK 2.0.0 release status

Updated: 2026-09-04 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `9ff6cf17f2ae5f11c0e245e6b534b90d647db623dd7f7905318077d84b3de8ab`
- Result: 21 of 21 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: all semantic, freshness, and binding checks passed.
- Node and schema conformance: 598/598 repository tests and 118/118
  Project-schema tests passed, with zero failures.
- Browser conformance: Chromium 102/102 and Firefox 76/76, with zero failed,
  pending, skipped, or todo tests; the WebKit and mobile contract suites each
  passed 4/4.
- Distribution: all 13 public packages passed tarball installation, Node
  consumer, Chromium consumer, Firefox consumer, release dry-run, and
  byte-for-byte reproducibility checks.
- Media evidence: exact seek, 1080p30/4K performance, durable WebM/fMP4
  interruption recovery, golden rendering, and the 60-second browser export
  with FFmpeg video-frame and audio-PCM readback all passed.
- Resource evidence: bounded decoder/cache/worker and transient-sampling
  queues, cancellation, disposal, provider drain, OPFS cleanup, the
  ten-minute-equivalent audio ring, the 400-iteration transaction
  restart-recovery soak, and the 1,000-clip incremental compilation soak
  passed.

The authoritative machine-readable record is
`reports/baseline/phase-1-gate-results.json`. Generated evidence in
`reports/baseline` is bound by byte count, SHA-256, producer command, and
freshness window.

## Implemented release scope

- Project schema v2.0 introduces a closed, typed Item union; explicit Track
  `role` and `occupancy`; first-class Gap Items; one-storyline-per-Sequence
  semantics; strict numeric bounds; and immutable v1.0/v1.2 migration.
- Timeline integration provides storyline packing, free/exclusive occupancy,
  collision-aware move plans, atomic placement writes, and speculative
  Project/Render-IR previews that do not enter undo history.
- Public authoring now includes ownership-safe factories for video, audio,
  image, text, caption, shape, generator, adjustment, nested-sequence, and Gap
  Items without requiring applications to hand-author entity JSON.
- Session media sampling provides bounded thumbnail and filmstrip requests with
  independent cancellation, replacement/disposal cleanup, and late-bitmap
  ownership protection. Player integrations add multi-listener time
  observation and an explicit reset lifecycle.
- Project validation decomposes the schema into reusable entity validators and
  caches only immutable object identities. Large edits retain whole-document
  semantic validation while avoiding unnecessary repeated schema work.
- Existing 1.x media, Material, rendering, audio, export, persistence,
  capability and diagnostic contracts remain available. Published v1.0 and
  v1.2 schema bytes remain immutable and bundled for migration.
- Root release tests and benchmarks explicitly exclude the independent nested
  Aelion Studio checkout, so source-bound SDK evidence cannot be changed by
  untracked Studio tests or browser benchmarks.

## Known boundaries

- Physical Safari/iOS/Android and broad GPU/driver matrices are not certified;
  those rows remain explicit pending-credential or pending-capture entries.
- Local color execution is RGBA8 SDR. HDR/10-bit requests fail closed where an
  executable path is unavailable.
- Reverse decode is bounded by GOP and cache policy; it is not a claim of
  constant-cost arbitrary reverse playback.
- SRT/WebVTT are supported; ASS/SSA is not part of the current subtitle
  contract.
- WebGPU supports the documented paths but does not yet have complete WebGL2
  parity certification across the physical device matrix.

## Release authorization and outcome

The only valid publication authorization is an `approved` decision in
`reports/baseline/phase-1-blocker-review.json` whose source manifest, gate
result, evidence files, status documents, and artifact-set hashes match this
run. Every required review category must be true and there must be no open
blocker.

Once that exact-bound review passes, tag `v2.0.0` publishes all 13 packages
with provenance to the npm `latest` dist-tag and creates a full GitHub Release.
The immutable release record is the tag, workflow run, GitHub Release, npm
provenance, and this bound evidence set.

Superseded `1.1.0-rc.1` and `1.2.0-rc.1` should not be newly adopted. Stable
`1.2.0` remains available for consumers that have not yet migrated to the v2.0
Project schema.

This file is a concise evidence index; the canonical user-facing status,
current limitations, and verification commands live in the
[documentation status page](https://foyonaczy.github.io/AelionSDK/project/status/).
