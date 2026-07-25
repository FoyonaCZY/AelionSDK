# AelionSDK release-candidate status

Updated: 2026-07-26 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `7cef4917e5671187b5214de44bb23e8ee7ad7772fde70220a83515da0a4b2525`
- Result: 14 of 14 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: passed.
- Browser conformance: Chromium 72/72 and Firefox 66/66, with zero failed,
  pending, skipped, or todo tests.
- Distribution: all 13 public packages passed tarball installation, Node
  consumer, Chromium consumer, Firefox consumer, and release dry-run checks.
- Media evidence: exact seek, 1080p30 performance, golden rendering, and the
  60-second browser export with FFmpeg video-frame and audio-PCM readback all
  passed.
- Resource evidence: bounded decoder/cache/worker queues, cancellation,
  disposal, provider drain, OPFS cleanup, ten-minute-equivalent audio ring, and
  the 1,000-clip incremental compilation soak passed.

The authoritative machine-readable record is
`reports/baseline/phase-1-gate-results.json`. Generated evidence in
`reports/baseline` is bound by byte count, SHA-256, producer command, and
freshness window.

## Implemented candidate scope

- Persistent sequential/GOP WebCodecs decoding and bounded frame/image caches.
- Whole-frame WebGL2/WebGPU frame graphs, adaptive backend selection, masks,
  effects, transitions, text, captions, shapes, generators, and all declared
  content types without silent drops.
- Public Composition/Layer/Clip APIs, canvas interaction and capture stream,
  plus strict WebAV and Diffusion Studio migration adapters.
- Silence removal transactions, waveform analysis, loudness/true-peak
  measurement, limiting, ducking, and capability-negotiated export profiles.
- Revision-bound persistence/recovery, isolated Worker extension RPC, reference
  editor autosave/restore, competitor benchmarks, migration guides, and public
  API snapshots.

## Remaining release authority

The automated candidate gates are complete. The repository's release policy
still requires an independent human blocker review bound to this exact source
manifest, gate record, and artifact set. Until that review is signed:

- `reports/baseline/phase-1-blocker-review.json` must remain `not-approved`;
- npm trusted publishing, provenance, version/tag, and GitHub Release must not
  be performed;
- this candidate must not be described as a published 1.0 release.

The independent reviewer must audit resource bounds, cancellation and cleanup,
material transport integrity, public API/distribution, and evidence integrity.
