# `@aelionsdk/core`

Shared time, diagnostics, JSON and resource-lifecycle primitives for
AelionSDK.

## Install

```bash
npm install @aelionsdk/core@next
```

`next` currently resolves to `1.1.0-rc.1`. Most applications receive these
types through `@aelionsdk/sdk`; direct use is intended for extensions and
custom engine hosts.

## Public surface

- integer-microsecond time and rational frame/sample conversion;
- `AelionError` and structured diagnostics;
- JSON value types;
- disposable and resource-tracking utilities.

Keep time values in integer microseconds at public boundaries, and preserve
diagnostic codes when wrapping errors so applications can recover
deterministically.

See the [time model](https://foyonaczy.github.io/AelionSDK/concepts/time-model/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/core/overview/).
Licensed under MIT.
