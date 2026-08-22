# `@aelionsdk/material-compiler`

Typed Aelion Material Protocol graph compiler for WebGL2 and WebGPU.

## Install

```bash
npm install @aelionsdk/material-compiler@next
```

`next` currently resolves to `1.2.0-rc.4`. Material authors should normally use
`@aelionsdk/material-sdk`; import this package directly to build a custom
compiler, renderer or validation host.

## Public surface

- Core Node registry and typed graph validation;
- graph compilation and resource-budget diagnostics;
- WebGL2 and WebGPU program generation;
- compiler input, output and backend types.

Treat generated Shader/WASM code as untrusted unless the host explicitly
authorizes its publisher and execution mode. Compilation success does not
bypass runtime resource budgets.

See the [Material guide](https://foyonaczy.github.io/AelionSDK/guides/materials/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/material-compiler/overview/).
Licensed under MIT.
