# AelionSDK 1.2.0 release status

Updated: 2026-08-24 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `faf025df7c06350bba8eb5e8ea9df1e265dc9dd0d3dbb9fff8a566a179e17781`
- Result: 21 of 21 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: all semantic, freshness, and binding checks passed.
- Browser conformance: Chromium 93/93 and Firefox 76/76, with zero failed,
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

## Implemented release scope

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
- rc.5 compositor path: pooled WebGL2 render targets and one context across
  render-scale changes; preview reuses the export compositor bypass when the
  decoded frame already matches the canvas, or shares its aspect ratio and can
  be scaled; preview `maxDimension` downscale at the provider boundary; shared
  LRU raster cache for text, generators and shapes.
- 1.2.0 compile freeze and playback: incremental compile reuses already-frozen
  IR subtrees; preview bypass hands decoded `VideoFrame`s over uncopied;
  `RenderIrFrameResult.bitmap` is `ImageBitmap | VideoFrame`; PCM window-cache
  hits skip admission; audio PCM sessions are reused; pause disconnects the
  worklet without flushing the ring; the preview clears after the last visual
  clip; items that own markers can be split. 4K30 real-media evidence excludes
  one same-session warmup export so the 1.5× floor measures a primed encoder.
- Corrected API boundaries: codec fallback is capability selection only and does
  not claim an executable WASM backend; audio energy changes are not described
  as video scene detection; deferred roadmap work remains marked deferred.

## Release outcome

The independent blocker review for `1.2.0` was approved against this exact
source manifest, gate record, and artifact set with every required check true
and no open blocker. Tag `v1.2.0` publishes all 13 packages with provenance to
the npm `latest` dist-tag and creates a GitHub Release.

`1.2.0-rc.5` through `1.2.0-rc.2` remain immutable npm artifacts.
`1.1.0-rc.1` and `1.2.0-rc.1` are superseded and should not be newly adopted.

This file is a concise evidence index; the canonical user-facing status,
current limitations, and verification commands live in the
[documentation status page](https://foyonaczy.github.io/AelionSDK/project/status/).
The immutable release record is the tag, workflow run, GitHub Release, npm
provenance, and this bound evidence set.
