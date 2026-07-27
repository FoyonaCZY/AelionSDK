# AelionSDK release-candidate status

Updated: 2026-07-27 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `edde42a68d61bbd7cb8a3ca757bcc046d4937a8cc6fdb27b9fc4541becb466fc`
- Source commit: `eb1ea9d29a0977f1893ecc0b18230c92ffa7a2d6`.
- Result: 21 of 21 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: 40 of 40 semantic, freshness, and binding checks passed.
- Browser conformance: Chromium 79/79 and Firefox 67/67, with zero failed,
  pending, skipped, or todo tests.
- Distribution: all 13 public packages passed tarball installation, Node
  consumer, Chromium consumer, Firefox consumer, release dry-run, and
  byte-for-byte reproducibility checks.
- Media evidence: exact seek, 1080p30/4K performance, durable WebM/fMP4
  interruption recovery, golden rendering, and the 60-second browser export
  with FFmpeg video-frame and audio-PCM readback all passed.
- Resource evidence: bounded decoder/cache/worker queues, cancellation,
  disposal, provider drain, OPFS cleanup, ten-minute-equivalent audio ring, and
  the 1,000-clip incremental compilation soak passed.

The authoritative machine-readable record is
`reports/baseline/phase-1-gate-results.json`. Generated evidence in
`reports/baseline` is bound by byte count, SHA-256, producer command, and
freshness window.

## Implemented candidate scope

- Persistent sequential/GOP WebCodecs decoding and bounded frame/image caches.
- Whole-frame WebGL2/WebGPU frame graphs with direct WebGPU presentation,
  adaptive backend selection, masks,
  effects, transitions, text, captions, shapes, generators, and all declared
  content types without silent drops.
- Public Composition/Layer/Clip APIs, canvas interaction and capture stream,
  plus strict WebAV and Diffusion Studio migration adapters.
- Silence removal transactions, waveform analysis, loudness/true-peak
  measurement, limiting, ducking, deterministic pitch-preserving time-stretch,
  deterministic 44.1/48/96 kHz streaming resampling for 1–8 channels, and
  capability-negotiated AVC/AV1/HEVC export profiles.
- Revision-bound persistence/recovery, isolated Worker extension RPC, reference
  editor autosave/restore, durable WebM/fMP4 unit checkpoints with IndexedDB
  resume and FFmpeg semantic readback, explicit
  non-Vite runtime assets, HDR/10-bit fail-closed execution contracts,
  competitor benchmarks, migration guides, and public API snapshots.

## Remaining release authority

The automated candidate gates are complete. The repository's release policy
still requires an independent human blocker review bound to this exact source
manifest, gate record, and artifact set. Until that review is signed:

- `reports/baseline/phase-1-blocker-review.json` must remain `not-approved`;
- npm publishing/provenance, Git tag, and GitHub Release must not be performed;
- this candidate must not be described as a published 1.0 release.

The independent reviewer must audit resource bounds, cancellation and cleanup,
material transport integrity, public API/distribution, and evidence integrity.
