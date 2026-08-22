# AelionSDK 1.2.0-rc.4 release-candidate status

Updated: 2026-08-23 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `80057004f0ede145d88250ca4d4ff9f4f0b2dbb795310e09a5f2d78cfcbf9dea`
- Result: 21 of 21 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: all semantic, freshness, and binding checks passed.
- Browser conformance: Chromium 90/90 and Firefox 75/75, with zero failed,
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
- 1.1/1.2 additions: QuickTime/MOV, Matroska/MKV and MPEG-TS container import;
  AVIF still decode and executable image-sequence rendering; diagnostic message
  localization; export/transaction property fuzz and restart-recovery soak;
  a bounded streaming proxy contract; signed rate envelopes; cubic-bezier
  handles; subtitle timing and silence alignment; audio beat/energy analysis;
  a codec-availability descriptor contract; Project Schema v1.2 with explicit
  migration from the legacy identity; a device-matrix certification scaffold;
  and a long-session operation guide.
- rc.3 runtime: pixel-space Y-up preview transforms with a dedicated text
  visual shader; still images on a synthetic SampleIndex; Vite 7 worker URL
  stability; `historyGroup` forwarded into command edit options; Aelion Studio
  moved to its own nested repository.
- rc.4 interactive preview: text/caption background plates; optional
  `transient` media requests; interactive commits that admit caller values at
  the transaction boundary instead of re-cloning the Project; playback that
  follows the clock and still rejects a superseded or disposed seek.
- Corrected API boundaries: codec fallback is capability selection only and does
  not claim an executable WASM backend; audio energy changes are not described
  as video scene detection; deferred roadmap work remains marked deferred.

## Release outcome

The independent blocker review for `1.2.0-rc.4` was approved against this exact
source manifest, gate record, and artifact set with every required check true
and no open blocker. Tag `v1.2.0-rc.4` publishes all 13 packages with
provenance to the npm `next` dist-tag and creates a GitHub prerelease.

`1.2.0-rc.3` and `1.2.0-rc.2` remain immutable npm artifacts. `1.1.0-rc.1` and
`1.2.0-rc.1` are superseded and should not be newly adopted.

This file is a concise evidence index; the canonical user-facing status,
current limitations, and verification commands live in the
[documentation status page](https://foyonaczy.github.io/AelionSDK/project/status/).
The immutable release record is the tag, workflow run, GitHub prerelease, npm
provenance, and this bound evidence set.
