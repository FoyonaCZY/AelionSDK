# `@aelionsdk/audio`

Audio scheduling and deterministic PCM processing primitives for AelionSDK.

## Install

```bash
npm install @aelionsdk/audio@next
```

`next` currently resolves to `1.2.0-rc.2`. Product applications should prefer
`@aelionsdk/sdk`; use this package directly when building a custom audio host,
analysis pipeline or renderer integration.

## Public surface

- IR audio mixing and channel matrices;
- streaming resampling and pitch-preserving time stretch;
- SharedArrayBuffer and transferable PCM queues;
- AudioWorklet clocks, device state and video scheduling.
- bounded beat and audio-energy change analysis. Audio analysis does not claim
  pixel-based video scene detection.

Queue and clock instances own browser and buffer resources. Stop producers,
cancel pending work and dispose the owning session or primitive when playback
ends.

See the [package map](https://foyonaczy.github.io/AelionSDK/reference/packages/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/audio/overview/).
Licensed under MIT.
