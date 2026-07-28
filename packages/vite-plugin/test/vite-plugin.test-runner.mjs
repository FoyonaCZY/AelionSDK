import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, createServer } from 'vite';

import {
  AelionWebpackPlugin,
  aelion,
  aelionRuntimeAssetUrls,
  loadAelionRuntimeAssets,
} from '../dist/index.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/app', import.meta.url));
const audioDist = fileURLToPath(new URL('../../audio/dist', import.meta.url));
const rendererDist = fileURLToPath(new URL('../../renderer-worker/dist', import.meta.url));
const exportDist = fileURLToPath(new URL('../../export/dist', import.meta.url));

function fixtureAlias() {
  return {
    '@aelionsdk/audio': resolve(audioDist, 'index.js'),
    '@aelionsdk/export': resolve(exportDist, 'index.js'),
    '@aelionsdk/renderer-worker': resolve(rendererDist, 'index.js'),
  };
}

async function testProductionBuild() {
  const result = await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [aelion()],
    resolve: { alias: fixtureAlias() },
    build: {
      target: 'es2023',
      write: false,
    },
  });
  const outputs = Array.isArray(result) ? result.flatMap(output => output.output) : result.output;
  const chunks = outputs.filter(output => output.type === 'chunk');
  const fileNames = chunks.map(chunk => chunk.fileName);
  assert(fileNames.some(name => name.includes('aelion-audio-pcm-player.worklet.js')));
  assert(fileNames.some(name => name.includes('aelion-audio-pcm-message-player.worklet.js')));
  assert(fileNames.some(name => name.includes('aelion-renderer-worker-webgl2-worker.js')));
  assert(fileNames.some(name => name.includes('aelion-export-mux-export-worker.js')));
  const applicationCode = chunks
    .filter(chunk => chunk.isEntry && !chunk.fileName.includes('aelion-'))
    .map(chunk => chunk.code)
    .join('\n');
  assert(!applicationCode.includes("new URL('./pcm-player.worklet.js'"));
  assert(!applicationCode.includes("new URL('./pcm-message-player.worklet.js'"));
  assert(!applicationCode.includes("new URL('./webgl2-worker.js'"));
  assert(!applicationCode.includes("new URL('./mux-export-worker.js'"));
}

async function testDevelopmentServer() {
  const server = await createServer({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [aelion()],
    resolve: { alias: fixtureAlias() },
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite dev test server did not expose a TCP address');
    }
    const origin = `http://127.0.0.1:${address.port.toString()}`;
    for (const path of [
      '/@aelionsdk/vite-plugin/runtime-assets/audio/pcm-player.worklet.js',
      '/@aelionsdk/vite-plugin/runtime-assets/audio/pcm-message-player.worklet.js',
      '/@aelionsdk/vite-plugin/runtime-assets/renderer-worker/webgl2-worker.js',
      '/@aelionsdk/vite-plugin/runtime-assets/export/mux-export-worker.js',
    ]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /javascript/u);
      assert((await response.text()).length > 100);
    }

    const clock = await server.transformRequest(`/@fs/${resolve(audioDist, 'worklet-clock.js')}`);
    assert(
      clock?.code.includes('/@aelionsdk/vite-plugin/runtime-assets/audio/pcm-player.worklet.js'),
    );
  } finally {
    await server.close();
  }
}

async function testBundlerNeutralRuntimeAssets() {
  const urls = aelionRuntimeAssetUrls('https://cdn.example.invalid/sdk/0.1.0/');
  assert.equal(
    urls.rendererWorker,
    'https://cdn.example.invalid/sdk/0.1.0/aelion/renderer-worker/webgl2-worker.js',
  );
  assert.equal(
    urls.transferableAudioWorklet,
    'https://cdn.example.invalid/sdk/0.1.0/aelion/audio/pcm-message-player.worklet.js',
  );

  const loaded = await loadAelionRuntimeAssets('runtime/aelion');
  assert.equal(loaded.length, 4);
  assert(loaded.every(asset => asset.bytes.byteLength > 100));

  let processAssets;
  const emitted = new Map();
  const plugin = new AelionWebpackPlugin({ outputDirectory: 'runtime/aelion' });
  plugin.apply({
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: 1 },
      sources: {
        RawSource: class RawSource {
          constructor(bytes) {
            this.bytes = bytes;
          }

          source() {
            return this.bytes;
          }
        },
      },
    },
    hooks: {
      thisCompilation: {
        tap(_name, callback) {
          callback({
            hooks: {
              processAssets: {
                tapPromise(_options, callback) {
                  processAssets = callback;
                },
              },
            },
            emitAsset(name, source) {
              emitted.set(name, source);
            },
          });
        },
      },
    },
  });
  await processAssets();
  assert.equal(emitted.size, 4);
  assert(emitted.has('runtime/aelion/export/mux-export-worker.js'));
}

await testProductionBuild();
await testDevelopmentServer();
await testBundlerNeutralRuntimeAssets();
// Vite/esbuild closes Windows async handles on the next libuv turns. Exiting
// from the stdout callback can race that close on newer Node releases.
await new Promise(resolve => globalThis.setTimeout(resolve, 250));
process.stdout.write(
  '@aelionsdk/vite-plugin tests passed: Vite, Webpack/Rspack, and explicit CDN assets\n',
  () => process.exit(0),
);
