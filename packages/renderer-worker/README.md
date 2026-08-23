# `@aelionsdk/renderer-worker`

Off-main-thread WebGL2/WebGPU composition and Worker protocol for AelionSDK.

## Install

```bash
npm install @aelionsdk/renderer-worker
```

`latest` currently resolves to `1.2.0`. Applications should create preview
surfaces through `@aelionsdk/sdk`; use this package directly for a custom render
host or Worker transport.

## Public surface

- renderer Worker client and protocol;
- Render IR compositor;
- WebGL2/WebGPU backend selection;
- font management and transferable frame results.

Frame results have explicit ownership. Close bitmaps that are not presented,
cancel superseded requests and dispose the Worker client so queued work and GPU
resources can drain.

See the [architecture guide](https://foyonaczy.github.io/AelionSDK/concepts/architecture/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/renderer-worker/overview/).
Licensed under MIT.
