import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, createServer } from 'vite';

import { aelion } from '../dist/index.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/app', import.meta.url));
const audioDist = fileURLToPath(new URL('../../audio/dist', import.meta.url));
const rendererDist = fileURLToPath(new URL('../../renderer-worker/dist', import.meta.url));

function fixtureAlias() {
  return {
    '@aelion/audio': resolve(audioDist, 'index.js'),
    '@aelion/renderer-worker': resolve(rendererDist, 'index.js'),
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
  const applicationCode = chunks
    .filter(chunk => chunk.isEntry && !chunk.fileName.includes('aelion-'))
    .map(chunk => chunk.code)
    .join('\n');
  assert(!applicationCode.includes("new URL('./pcm-player.worklet.js'"));
  assert(!applicationCode.includes("new URL('./pcm-message-player.worklet.js'"));
  assert(!applicationCode.includes("new URL('./webgl2-worker.js'"));
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
      '/@aelion/vite-plugin/runtime-assets/audio/pcm-player.worklet.js',
      '/@aelion/vite-plugin/runtime-assets/audio/pcm-message-player.worklet.js',
      '/@aelion/vite-plugin/runtime-assets/renderer-worker/webgl2-worker.js',
    ]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /javascript/u);
      assert((await response.text()).length > 100);
    }

    const clock = await server.transformRequest(`/@fs/${resolve(audioDist, 'worklet-clock.js')}`);
    assert(clock?.code.includes('/@aelion/vite-plugin/runtime-assets/audio/pcm-player.worklet.js'));
  } finally {
    await server.close();
  }
}

await testProductionBuild();
await testDevelopmentServer();
process.stdout.write('@aelion/vite-plugin tests passed: production build, development server\n');
