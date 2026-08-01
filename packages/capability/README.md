# `@aelionsdk/capability`

Browser media, graphics, storage and execution capability probing for
AelionSDK.

## Install

```bash
npm install @aelionsdk/capability@next
```

`next` currently resolves to `1.1.0-rc.1`. Product applications should normally
use the capability APIs exposed by `@aelionsdk/sdk`; this package is for custom
preflight screens and execution hosts.

## Public surface

- browser capability probes;
- capability reports and typed results;
- fail-closed gates for required features and export profiles.

A declared browser API is not proof that a codec configuration works. Run the
relevant gate with the actual dimensions, frame rate, sample rate and channel
count before starting a job.

See the [capability preflight guide](https://foyonaczy.github.io/AelionSDK/production/capability-preflight/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/capability/overview/).
Licensed under MIT.
