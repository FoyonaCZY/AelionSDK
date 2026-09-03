---
title: Migrate from WebAV and Diffusion Studio
description: Convert WebAV sprites or Diffusion checkpoints into Project v2 with an explicit loss report.
---

## WebAV

The WebAV migrator maps supported sprite timing, media references, transforms, opacity, audio, and
track order into Aelion assets/tracks/items. Features without a deterministic equivalent are
reported with source location, severity, and remediation instead of being silently discarded.

## Diffusion Studio Core

The Diffusion migrator reads a checkpoint plus an explicit asset map, converts supported
composition/timeline state, and reports differences in effects, transitions, text/font behavior,
plugins, or rendering semantics.

## CLI

```bash
pnpm exec aelion-migrate --from webav --input webav.json --out project.aelion.json
pnpm exec aelion-migrate --from diffusion --input checkpoint.json \
  --assets assets.json --dry-run
```

The same file API is available from `@aelionsdk/sdk/migrate-cli`.

## Strict and permissive modes

Strict mode never writes a Project when required semantics cannot be represented. Use it for batch
or unattended migration. Permissive mode may emit a valid partial Project only together with the
versioned loss report; reserve it for a human repair workflow and retain the source artifact.

After conversion, reconnect media, load with the current validator, review representative frames
and audio, and export a golden sample before accepting the migration.
