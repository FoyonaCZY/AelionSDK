# `@aelionsdk/material-sdk`

Type-safe authoring, validation, packaging, signing and trust tools for Aelion
Material Protocol v1.

## Install

```bash
npm install @aelionsdk/material-sdk@next
```

## Author CLI

The package installs `aelion-material`:

```bash
pnpm exec aelion-material init ./my-pack
pnpm exec aelion-material build ./my-pack
pnpm exec aelion-material validate ./my-pack
pnpm exec aelion-material types ./my-pack
pnpm exec aelion-material preview ./my-pack
pnpm exec aelion-material prepublish ./my-pack
pnpm exec aelion-material pack ./my-pack --out ./dist/my-pack.aelionmat
pnpm exec aelion-material golden actual.rgba expected.rgba --tolerance 2
```

`build` refreshes declared payload sizes/hashes and generates types plus the
preview report. `prepublish` requires valid payload hashes and schemas, no error diagnostics,
strict determinism, and WebGL2/WebGPU compiler parity for declarative Graph
materials. The `.aelionmat` archive is deterministic.

Signing keys are deliberately not read by the generic CLI. A host that owns a
publisher key should obtain a `CryptoKey` from its own key system and call
`signMaterialPackage()` explicitly.

Node build systems can import the same operations from
`@aelionsdk/material-sdk/author-cli`.

## TypeScript API

```ts
import {
  MaterialLabSession,
  materialDefinition,
  materialGraph,
  packMaterialPackage,
} from '@aelionsdk/material-sdk';
```

See the [Material guide](https://foyonaczy.github.io/AelionSDK/guides/materials/)
and [AMP v1 reference](https://foyonaczy.github.io/AelionSDK/reference/material-protocol-v1/).

Version `1.2.0-rc.4` is a prerelease. Public changes before 1.0 are recorded
in the repository changelog and migration documentation. Licensed under MIT.
