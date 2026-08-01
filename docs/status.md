# AelionSDK release-candidate status

Updated: 2026-08-01 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `a0bc1d83d3bed1285bbf1dc996553219c7359f72a252949328fdff08851511c7`
- Result: 21 of 21 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: all semantic, freshness, and binding checks passed.
- Browser conformance: Chromium 84/84 and Firefox 69/69, with zero failed,
  pending, skipped, or todo tests.
- Distribution: all 13 public packages passed tarball installation, Node
  consumer, Chromium consumer, Firefox consumer, release dry-run, and
  byte-for-byte reproducibility checks.
- Media evidence: exact seek, 1080p30/4K performance, durable WebM/fMP4
  interruption recovery, golden rendering, and the 60-second browser export
  with FFmpeg video-frame and audio-PCM readback all passed.
- Resource evidence: bounded decoder/cache/worker queues, cancellation,
  disposal, provider drain, OPFS cleanup, ten-minute-equivalent audio ring, the
  400-iteration transaction restart-recovery soak, and the 1,000-clip
  incremental compilation soak passed.

The authoritative machine-readable record is
`reports/baseline/phase-1-gate-results.json`. Generated evidence in
`reports/baseline` is bound by byte count, SHA-256, producer command, and
freshness window.

## Implemented candidate scope

- 1.0 engine scope: persistent sequential/GOP WebCodecs decoding, whole-frame
  WebGL2/WebGPU frame graphs, public Composition/Layer/Clip APIs, strict
  WebAV and Diffusion Studio migration, audio mastering tooling, revision-bound
  persistence/recovery, Material protocol, and HDR fail-closed contracts.
- 1.1 additions: QuickTime/MOV, Matroska/MKV and MPEG-TS container import;
  AVIF still decode and image-sequence assets; diagnostic message
  localization; export/transaction property fuzz and restart-recovery soak;
  a software codec fallback contract; a device-matrix certification scaffold;
  and a long-session operation guide.

## Release outcome

The independent blocker review bound to this source manifest, gate record, and
artifact set is signed `approved` in
`reports/baseline/phase-1-blocker-review.json`. The reviewer accepted resource
bounds, cancellation and cleanup, Material transport integrity, public
API/distribution, and evidence integrity with no open blockers.

Version `1.1.0-rc.1` is published as:

- all 13 `@aelionsdk/*` packages on npm under the `next` dist-tag, with
  provenance;
- Git tag `v1.1.0-rc.1`;
- a GitHub prerelease after registry smoke completed.

The immutable release record is the
[`v1.1.0-rc.1` tag](https://github.com/FoyonaCZY/AelionSDK/tree/v1.1.0-rc.1),
the release workflow run, and the
[GitHub prerelease](https://github.com/FoyonaCZY/AelionSDK/releases/tag/v1.1.0-rc.1).
This file is a concise evidence index; the canonical user-facing status,
current limitations, and verification commands live in the
[documentation status page](https://foyonaczy.github.io/AelionSDK/project/status/).
Post-release documentation changes on `main` do not alter the evidence captured
at the release tag.
