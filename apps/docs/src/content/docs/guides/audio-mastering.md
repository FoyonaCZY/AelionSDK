---
title: Audio analysis, silence removal, and mastering
description: Generate waveforms and loudness reports, then apply undoable cleanup and master settings.
---

## Analysis

Use the Session audio surface to request bounded waveform peaks, loudness measurements, and silence
regions for the current Project/revision. Cache results by immutable media and analysis settings,
and cancel work invalidated by edits or project replacement.

## Silence removal is an edit

Convert approved silence regions into semantic ripple/trim commands inside one transaction or
interaction group. Show the proposed cuts first. If any source handle, lock, link, or transition
constraint fails, leave the Project unchanged.

## Master settings belong in Project

Write ducking, target loudness, normalization, gain, fade, limiter, and peak policy into the
versioned Project audio/master model so preview and export evaluate the same settings. Keep
meter-window UI state outside Project.

## Negotiate before export

Run capability and export preflight with the final sample rate, channel layout, profile, and
mastering configuration. Unsupported pitch, channel, codec, or offline Material behavior should
produce an actionable fallback rather than a silent change.
