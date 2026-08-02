# `@aelionsdk/capability`

Browser media, graphics, storage and execution capability probing for
AelionSDK.

## Install

```bash
npm install @aelionsdk/capability@next
```

`next` currently resolves to `1.2.0-rc.2`. Product applications should normally
use the capability APIs exposed by `@aelionsdk/sdk`; this package is for custom
preflight screens and execution hosts.

## Public surface

- browser capability probes;
- capability reports and typed results;
- software codec capability descriptors (not an executable codec backend);
- fail-closed gates for required features and export profiles.

A declared browser API is not proof that a codec configuration works. Run the
relevant gate with the actual dimensions, frame rate, sample rate and channel
count before starting a job.
`CodecFallbackRegistry` records host-owned capabilities only; Aelion media and
export do not route work through registered descriptors.

See the [capability preflight guide](https://foyonaczy.github.io/AelionSDK/production/capability-preflight/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/capability/overview/).
Licensed under MIT.
