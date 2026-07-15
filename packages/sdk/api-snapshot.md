# `@aelion/sdk` public API snapshot

Version: `0.1.0-alpha.0`

This checked-in manifest is intentionally structural. `check-api-snapshot.mjs`
extracts the public declarations reachable from `dist/index.d.ts`, compares the
exported symbol set and hashes each declaration file. Any declaration edit,
addition, removal, or accidental public export must be reviewed by updating this
baseline in the same change.

```json
{
  "schemaVersion": "1.0.0",
  "package": "@aelion/sdk",
  "version": "0.1.0-alpha.0",
  "entrypoint": "dist/index.d.ts",
  "files": {
    "dist/default-schemas.d.ts": "60956845e621cd1a663df4807d6073666e2062b106d2d967f529a2ac703f2ab8",
    "dist/index.d.ts": "ce115215a0229d45f9ad2520ce844bddfa1c295326479cd760b845807512b37a",
    "dist/media-provider.d.ts": "9d16243e4d1350f9495c001fd39b5d0182eadf1860106b6f41b8d62a8960ad2a",
    "dist/player.d.ts": "53bfc4a663ce7e3d02d5a1101c1c5bdd75a25a162a31adf85a01a7e4d8924d9f",
    "dist/runtime-material-registry.d.ts": "e74c432da12a8f5384fd133d6a30a8dd8953d38ec910ed0491e8c6018bca133b",
    "dist/session.d.ts": "0e8d6c2f2755a7efd8e3c8455d923e6c79e38725847afa3bd990e0e6b162a61f",
    "dist/types.d.ts": "824dc1a9e1fcdb1eea633d28d3666b0ea9187735c63ff5b5d84d049fb4ad9924"
  },
  "exports": [
    "Aelion",
    "AelionApi",
    "AelionAssetBytesResolver",
    "AelionExportApi",
    "AelionExportJob",
    "AelionExportJobSnapshot",
    "AelionExportJobState",
    "AelionExportOptions",
    "AelionMediaProvider",
    "AelionPlayerApi",
    "AelionPlayerFrame",
    "AelionPlayerResourceStats",
    "AelionPlayerState",
    "AelionPlayerStats",
    "AelionPreviewApi",
    "AelionPreviewOptions",
    "AelionProjectSchemas",
    "AelionRuntimeMaterialRegistry",
    "AelionSession",
    "AelionSessionApi",
    "AelionSessionEvent",
    "AelionSessionEventOf",
    "AelionSessionEventType",
    "AelionSessionOptions",
    "AelionSessionSnapshot",
    "AelionSessionState",
    "AelionSessionStats",
    "AelionTransactionApi",
    "ByteMediaProvider",
    "ByteMediaProviderOptions",
    "RuntimeMaterialRegistry",
    "defaultSchemas"
  ]
}
```
