# `@aelionsdk/sdk`

Browser-first video editing, preview, playback and export APIs for AelionSDK.

## Install 2.0

```bash
npm install @aelionsdk/sdk
npm install --save-dev @aelionsdk/vite-plugin vite
```

`latest` currently resolves to `2.0.0`. Pin the exact version after
validation instead of following a moving dist-tag.

## Vite setup

```ts
// vite.config.ts
import { aelion } from '@aelionsdk/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

The plugin emits the Renderer Worker, Export Worker and both AudioWorklet
entries. Non-Vite hosts can deploy those entries themselves and pass their
URLs through `AelionSessionOptions.runtimeAssets`.

## Start a session

```ts
import { Aelion, ProductionMediaProvider, createProject } from '@aelionsdk/sdk';

const media = new ProductionMediaProvider();
const session = await Aelion.createSession({ media });

const builder = createProject({
  projectId: 'project_main',
  title: 'My project',
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
  sampleRate: 48_000,
});

await session.loadProject(builder.build());
```

New Projects use the immutable Project Schema `v2.0.json / 2.0.0` identity.
`migrateProjectToCurrent()` upgrades supported v1.0 and stable v1.2 documents
from an ownership-isolated snapshot without mutating caller data.
Large automatic-proxy sources require the RangeReader encoder contract; the
legacy whole-buffer path has a bounded default input limit.

See the [AelionSDK documentation](https://foyonaczy.github.io/AelionSDK/) for
media registration, Composition APIs, preview, local export, persistent
checkpoints, deployment headers and capability preflight.

## Migrate WebAV or Diffusion projects

The package also installs `aelion-migrate`. It produces a validated Project
and a versioned loss report; strict mode never writes a Project when rendering
semantics cannot be preserved.

```bash
pnpm exec aelion-migrate --from webav --input webav.json --out project.aelion.json
pnpm exec aelion-migrate --from diffusion --input checkpoint.json \
  --assets assets.json --dry-run
```

Use the `@aelionsdk/sdk/migrate-cli` subpath to call the same file migration
API from Node.js.

## Compatibility contract

The release is tested on the automated Chromium and Firefox matrix. Playwright
WebKit and a mobile viewport cover public capability and fallback contracts;
physical Safari, iOS and Android devices are not yet certified. Local color
execution is RGBA8 SDR. Public API changes follow SemVer and are recorded in the
repository changelog and migration guide.

AelionSDK is licensed under the MIT License.
