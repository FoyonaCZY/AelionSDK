# AelionSDK 1.2 remediation release-candidate status

Updated: 2026-08-02 (Asia/Shanghai)

## Bound final gate run

- Source manifest:
  `9d61b2124b579812ca413a588c7b1384eebc1e477f728304d8bd45fedbe86006`
- Result: 21 of 21 serial commands passed.
- Source identity: identical before and after the run.
- Artifact postflight: all semantic, freshness, and binding checks passed.
- Browser conformance: Chromium 85/85 and Firefox 70/70, with zero failed,
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
- Corrected API boundaries: codec fallback is capability selection only and does
  not claim an executable WASM backend; audio energy changes are not described
  as video scene detection; deferred roadmap work remains marked deferred.

## Remediation release plan

The independent blocker review for `1.2.0-rc.2` must be bound to this exact
source manifest, gate record, and artifact set before the release workflow can
publish. Its machine-readable `decision` is authoritative: only `approved`
with every required check true, no open blockers, and an exact binding makes
the candidate eligible for provenance publication. This status does not infer
approval from an older release review.

Versions `1.1.0-rc.1` and `1.2.0-rc.1` are immutable npm artifacts and will not
be overwritten or unpublished. They are superseded because their delivered
behavior and documentation did not fully match the advertised contracts.

After `1.2.0-rc.2` is visible for all 13 `@aelionsdk/*` packages, the release
process will:

- keep prereleases on the `next` dist-tag, never `latest`;
- mark both older RC versions deprecated with a pointer to `1.2.0-rc.2`;
- create Git tag `v1.2.0-rc.2` and a GitHub prerelease with provenance; and
- run registry smoke checks against the exact published tarballs.

Consumers should not newly adopt either superseded RC. Until the replacement is
visible in the registry, wait rather than resolving `@next` to an older RC.

This file is a concise evidence index; the canonical user-facing status,
current limitations, and verification commands live in the
[documentation status page](https://foyonaczy.github.io/AelionSDK/project/status/).
After release, the immutable record will be the tag, workflow run, GitHub
prerelease, npm provenance, and this bound evidence set.
