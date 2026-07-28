---
title: Maintain the repository and prepare a release
description: Set up development, choose validation by risk, run CI, and satisfy release gates.
---

This page is for AelionSDK contributors. Application integrators can start with
[Installation and configuration](/AelionSDK/start/installation/).

## Development environment

Use the Node and pnpm versions declared by the repository, enable Corepack, install from the frozen
lockfile, and run the quickstart before changing engine code.

## Common commands

| Command                               | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `corepack pnpm run ci`                | Complete local quality gate                              |
| `corepack pnpm test`                  | Unit and integration tests                               |
| `corepack pnpm docs:check`            | Markdown, locale, release-doc, and package README checks |
| `corepack pnpm docs:build`            | TypeDoc and Starlight production build                   |
| `corepack pnpm release:version:check` | Manifest and release-document version sync               |
| `corepack pnpm release:dry-run`       | Pack and inspect all 13 public packages                  |

## Develop an engine feature

### Define the contract

Document input, output, ownership, thread, revision, cancellation, error codes, compatibility, and
resource limits before implementation.

### Follow the complete execution path

Project/Schema changes must reach builders, validation, migration, transactions, Render IR,
preview/player/export, public types, examples, and docs as applicable. Avoid implementing the same
semantic rule independently in preview and export.

### Failure, cancellation, and cleanup

Test success plus invalid input, unsupported capability, cancellation at each asynchronous stage,
partial sink cleanup, worker failure, project replacement, and repeated disposal.

### Test by risk

Use focused unit tests for pure logic, schema/property tests for data boundaries, browser tests for
Web APIs and lifecycle, golden tests for rendering/materials, long-form tests for resources, and
package dry-runs for distribution.

## Change checklist

- Project/Transaction: schema, canonicalization, ownership, migration, revision, undo.
- Render/Material: shared IR, backend parity, budgets, trust, golden output.
- Media/Audio/Export: timestamps, range/CORS, ownership, worklet/worker, sink terminal states.
- Public API: exports, types, API snapshot, README, migration note, package contents.

## CI and versions

PR CI runs quality, Chromium/Firefox smoke tests, and documentation build. Nightly/release evidence
adds longer matrices. All workspace packages share one version; RC breaking changes require
CHANGELOG and migration documentation.

## Release gate

Release only from reviewed immutable source/evidence identities after CI, dry-run package
inspection, Trusted Publishing/provenance configuration, registry/tag verification, and the
documented five-boundary review.

## Documentation rules

Keep English and Chinese routes in one-to-one parity, update stable guides rather than adding stale
status fragments, commit a README for every package, rebuild TypeDoc from a clean cache, and reduce
rather than increase the API narrative-coverage baseline.
