# `@aelionsdk/media`

Range I/O, media indexing, exact seek, decoding, cache and proxy primitives for
AelionSDK.

## Install

```bash
npm install @aelionsdk/media@next
```

`next` currently resolves to `1.0.0-rc.1`. Applications should prefer
`ProductionMediaProvider` from `@aelionsdk/sdk`; direct use is intended for
custom media providers, cache implementations and decode hosts.

## Public surface

- HTTP/file range readers and proxy contracts;
- MP4/WebM indexing and exact seek;
- video, audio and image adapters;
- content-addressed cache and OPFS storage;
- shared decoder, cache and request resource governance.

Callers own returned browser media resources unless an API explicitly transfers
ownership. Close frames, cancel obsolete reads and release cache/provider
resources when a session ends.

See the [media lifecycle guide](https://foyonaczy.github.io/AelionSDK/concepts/media-lifecycle/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/media/overview/).
Licensed under MIT.
