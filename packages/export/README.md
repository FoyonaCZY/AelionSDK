# `@aelionsdk/export`

Streaming WebCodecs export, muxing, sinks, checkpoints and remote-export
contracts for AelionSDK.

## Install

```bash
npm install @aelionsdk/export@next
```

`next` currently resolves to `1.0.0-rc.1`. Applications usually start exports
through an `@aelionsdk/sdk` Session and depend on this package for sinks,
profiles or remote-export types.

## Public surface

- WebM and MP4 video export profiles;
- image, GIF and WAV/RF64 export;
- memory and OPFS seekable sinks;
- resumable muxed checkpoints and Worker export;
- authenticated remote-export provider contracts.

Always propagate `AbortSignal`, await sink finalization and dispose partial
output according to the selected sink contract. Codec support must be
preflighted for the exact output configuration.

See the [export guide](https://foyonaczy.github.io/AelionSDK/export/overview/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/export/overview/).
Licensed under MIT.
