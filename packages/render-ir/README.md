# `@aelionsdk/render-ir`

Incremental Project-to-Render-IR compilation and deterministic timeline
evaluation for AelionSDK.

## Install

```bash
npm install @aelionsdk/render-ir@next
```

`next` currently resolves to `1.0.0-rc.1`. Product applications should use
`@aelionsdk/sdk`; direct use is for custom renderers, exporters and engine
instrumentation.

## Public surface

- cold and incremental Project compilation;
- visual and audio timeline evaluation;
- captions, text layout and time maps;
- color and bit-depth contracts;
- compile statistics and Render IR types.

Preview and export should consume the same validated Render IR rather than
maintaining separate timeline semantics. Unsupported color or time-map
combinations fail closed.

See the [render consistency guide](https://foyonaczy.github.io/AelionSDK/concepts/render-consistency/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/render-ir/overview/).
Licensed under MIT.
