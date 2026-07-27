# `@aelionsdk/sdk`

Browser-first video editing, preview, playback and export APIs for AelionSDK.

## Install the public Beta

```bash
npm install @aelionsdk/sdk@next
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

`next` currently resolves to `0.1.0-beta.1`. Pin the exact version after
validation instead of following a moving prerelease tag.

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

See the [AelionSDK documentation](https://foyonaczy.github.io/AelionSDK/) for
media registration, Composition APIs, preview, local export, persistent
checkpoints, deployment headers and capability preflight.

## Beta contract

The Beta is tested on the automated Chromium and Firefox matrix. Playwright
WebKit and a mobile viewport cover public capability and fallback contracts;
physical Safari, iOS and Android devices are not yet certified. Local color
execution is RGBA8 SDR. Public APIs may still change before the first stable
release and will be recorded in the repository changelog and migration guide.

AelionSDK is licensed under the MIT License.
