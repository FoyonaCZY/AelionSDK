---
title: Current release status
description: Review the published version, verification evidence, known boundaries, and remaining certification.
---

## What is available

AelionSDK `1.2.0-rc.1` is published as 13 `@aelionsdk/*` packages on npm under the `next` dist-tag.
The Git tag and GitHub prerelease identify the reviewed source. Applications normally begin with
`@aelionsdk/sdk@next` and add the Vite plugin or export package as needed.

## Release identity

The release was produced by GitHub Actions Trusted Publishing with npm provenance. Verify the exact
version, integrity, attestations, dist-tags, Git tag, GitHub release, and workflow rather than
trusting a README badge alone. Commands are in
[Installation and configuration](/AelionSDK/start/installation/#verify-release-identity).

## Evidence

Repository evidence covers unit/type/schema/API/package gates, Chromium and Firefox browser smoke
tests, compatibility/fallback contracts, rendering golden data, performance/resource scenarios,
release manifests, and npm package dry-runs. Regenerable evidence under `reports/baseline` belongs
to the source revision that produced it.

## Known boundaries

- The RC API can still change before stable according to the migration policy.
- Current local color execution is RGBA8 SDR; production HDR is not certified.
- AV1, HEVC, WebGPU, 4K, OPFS, and exact codecs are capability-negotiated.
- Physical Safari/iOS/Android and broad real-device codec matrices need continued certification.
- A browser page is not a guaranteed long-running background service; remote export remains the
  durable option for jobs that must survive lifecycle limits.

## Source-complete is not delivered

Roadmap items such as broader certification, ecosystem integrations, collaborative services, or
additional backends are not considered shipped until code, public contract, docs, CI/evidence, and
published artifacts all exist.

## Local verification

Run `corepack pnpm run ci` and `corepack pnpm release:dry-run` from the tagged source. Compare the
result with the immutable release identities before approving another publication.

Historical goals and ADRs remain available through Git history; current behavior is defined by
this status page, capabilities, architecture, compatibility, public API, and package artifacts.
