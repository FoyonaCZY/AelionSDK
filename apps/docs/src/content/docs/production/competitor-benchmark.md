---
title: Same-page WebAV and Diffusion benchmark
description: Reproduce preview and seek measurements for Aelion, WebAV, and Diffusion Studio Core.
---

The competitor harness runs all engines in the same Chromium page, device profile, media set, warmup
policy, sample count, and measurement clock. It records environment identity and raw observations
so a summary cannot be detached from its source evidence.

Covered scenarios include cold initialization/first frame, repeated warm seeks, rapid seek
supersession, steady preview/playback where comparable, memory/resource observations, and cleanup.
An unsupported scenario is reported as unsupported, not converted into zero time or removed from
the comparison.

## Interpreting results

- Compare the same semantic work and output dimensions.
- Separate cold setup from warm steady state.
- Use median and tail latency together; inspect raw samples.
- Treat browser scheduling noise and codec/backend choice as part of the environment.
- Do not extrapolate a single clip to long timelines, effects, audio, export, or mobile.
- Re-run after dependency, browser, hardware, or implementation changes.

The repository benchmark report is evidence for that exact revision and environment, not a
permanent universal ranking. Use [Performance and resource budgets](/AelionSDK/production/performance/)
to define product-specific acceptance.
