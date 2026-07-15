/* eslint-disable */

import { AudioWorkletClock } from '@aelion/audio';
import { compileMaterialGraphToWebGl2 } from '@aelion/material-compiler';
import { WorkerCompositor } from '@aelion/renderer-worker';
import { Aelion } from '@aelion/sdk';

const resultElement = document.querySelector('#result');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorDetails(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? '',
    };
  }
  return { name: 'UnknownError', message: String(error), stack: '' };
}

function publish(value) {
  window.__AELION_TARBALL_CONSUMER__ = value;
  if (resultElement !== null) resultElement.textContent = JSON.stringify(value, null, 2);
}

async function waitUntil(predicate, description, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
  }
}

function solidFrame(red, green, blue, timestamp = 0) {
  const canvas = new OffscreenCanvas(8, 8);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('OffscreenCanvas 2D context is unavailable');
  context.fillStyle = `rgb(${red} ${green} ${blue})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return new VideoFrame(canvas, { timestamp });
}

function centerPixel(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Bitmap readback context is unavailable');
  context.drawImage(bitmap, 0, 0);
  return [
    ...context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data,
  ];
}

async function exerciseWorkerCompositor() {
  const graph = {
    $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
    graphVersion: '1.0.0',
    nodeSet: 'aelion.visual.nodes/1.0.0',
    nodes: [
      {
        id: 'invert',
        type: 'color.invert',
        typeVersion: '1.0.0',
        inputs: { source: { inputPort: 'source' } },
      },
    ],
    outputs: { result: { node: 'invert', output: 'frame' } },
  };
  const program = compileMaterialGraphToWebGl2(graph, {
    parameters: {},
    inputPorts: { source: 'visual-frame' },
  });
  const compositor = new WorkerCompositor();
  try {
    const composed = await compositor.compose({
      inputs: { source: solidFrame(10, 20, 30) },
      program,
      width: 8,
      height: 8,
      preferredBackend: 'webgl2',
      allowFallback: false,
    });
    try {
      const pixel = centerPixel(composed.bitmap);
      const expected = [245, 235, 225, 255];
      assert(composed.backend === 'webgl2', 'Worker compositor did not use WebGL2');
      assert(composed.graphHash === program.graphHash, 'Worker compositor graph hash changed');
      assert(
        composed.bitmap.width === 8 && composed.bitmap.height === 8,
        'Worker output has the wrong size',
      );
      pixel.forEach((channel, index) => {
        assert(
          Math.abs(channel - expected[index]) <= 2,
          `Worker pixel channel ${index} was ${channel}; expected ${expected[index]}`,
        );
      });
      assert(composed.resources.inputFrames === 0, 'Worker retained an input VideoFrame');
      assert(compositor.snapshot().pendingRequests === 0, 'Worker request queue did not drain');
      return {
        backend: composed.backend,
        graphHash: composed.graphHash,
        pixel,
        workerTimingUs: composed.timing.totalWorkerUs,
      };
    } finally {
      composed.bitmap.close();
    }
  } finally {
    compositor.dispose();
  }
}

async function exerciseAudioWorkletClock() {
  const clock = new AudioWorkletClock({ capacityFrames: 96_000, channelCount: 2 });
  try {
    const queuedFrames = Math.floor(clock.context.sampleRate / 2);
    const pcm = new Float32Array(queuedFrames * 2);
    for (let frame = 0; frame < queuedFrames; frame += 1) {
      const sample = Math.sin((frame * 2 * Math.PI * 220) / clock.context.sampleRate) * 0.005;
      pcm[frame * 2] = sample;
      pcm[frame * 2 + 1] = sample;
    }
    assert(clock.ring.writeInterleaved(pcm) === queuedFrames, 'Audio PCM ring rejected input');
    await clock.initialize(128);
    await clock.start();
    await waitUntil(() => clock.ring.snapshot().playedFrames > 0, 'AudioWorklet PCM consumption');
    await clock.pause();
    const snapshot = clock.ring.snapshot();
    assert(snapshot.playedFrames > 0, 'AudioWorklet did not consume PCM');
    assert(clock.nowUs() > 0, 'AudioWorklet clock did not advance');
    return {
      contextState: clock.context.state,
      sampleRate: clock.context.sampleRate,
      quantumFrames: 128,
      queuedFrames,
      capacityFrames: snapshot.capacityFrames,
      availableReadFrames: snapshot.availableReadFrames,
      playedFrames: snapshot.playedFrames,
      underrunFrames: snapshot.underrunFrames,
      timeUs: clock.nowUs(),
    };
  } finally {
    await clock.dispose();
  }
}

function createProject() {
  return {
    $schema: 'https://schemas.aelion.dev/project/v1.json',
    schemaVersion: '1.0.0',
    projectId: 'prj_tarball_consumer',
    metadata: { title: 'Tarball browser consumer' },
    settings: {
      defaultSequenceId: 'seq_main',
      defaultStillDurationUs: 1_000_000,
      missingAssetPolicy: 'error',
      missingMaterialPolicy: 'error',
      missingPluginPolicy: 'error',
    },
    assets: {
      asset_color: {
        id: 'asset_color',
        kind: 'video',
        locator: { type: 'runtime-binding', bindingId: 'tarball-color-source' },
        mimeType: 'video/raw',
      },
    },
    sequences: {
      seq_main: {
        id: 'seq_main',
        name: 'Tarball consumer sequence',
        format: {
          width: 16,
          height: 16,
          pixelAspectRatio: { numerator: 1, denominator: 1 },
          frameRate: { numerator: 30, denominator: 1 },
          sampleRate: 48_000,
          channelLayout: 'stereo',
          workingColorSpace: 'srgb-linear',
          backgroundColor: { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
        },
        duration: { mode: 'fixed', durationUs: 1_000_000, overflow: 'clip' },
        trackIds: ['track_video'],
        transitionIds: [],
        materialInstanceIds: [],
        markerIds: [],
      },
    },
    tracks: {
      track_video: {
        id: 'track_video',
        sequenceId: 'seq_main',
        kind: 'visual',
        enabled: true,
        locked: false,
        itemIds: ['item_video'],
        materialInstanceIds: [],
      },
    },
    items: {
      item_video: {
        id: 'item_video',
        trackId: 'track_video',
        type: 'video',
        enabled: true,
        range: { startUs: 0, durationUs: 1_000_000 },
        source: {
          assetId: 'asset_color',
          stream: { type: 'video', index: 0 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          timeMapping: {
            type: 'linear',
            rate: { numerator: 1, denominator: 1 },
            reverse: false,
            boundary: 'hold',
          },
        },
        visual: {
          fit: 'fill',
          transform: {
            positionPx: { x: 8, y: 8 },
            anchor: { x: 0.5, y: 0.5 },
            scale: { x: 1, y: 1 },
            rotationDeg: 0,
            skewDeg: { x: 0, y: 0 },
          },
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
          opacity: 1,
          blendMode: 'normal',
        },
        materialInstanceIds: [],
      },
    },
    materialInstances: {},
    transitions: {},
    markers: {},
    linkGroups: {},
    extensions: {},
  };
}

async function exerciseSessionFacade() {
  const session = await Aelion.createSession({
    preferredBackend: 'webgl2',
    allowBackendFallback: false,
    media: {
      frameAt: (_assetId, _streamIndex, sourceTimeUs) => {
        const canvas = new OffscreenCanvas(16, 16);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Session media canvas is unavailable');
        context.fillStyle = 'rgb(32 96 192)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        return Promise.resolve(new VideoFrame(canvas, { timestamp: sourceTimeUs }));
      },
      pcmRange: () =>
        Promise.resolve({
          sampleRate: 48_000,
          channelCount: 2,
          frameCount: 0,
          interleaved: new Float32Array(),
        }),
    },
  });
  try {
    await session.loadProject(createProject());
    const edit = session.transaction.edit(transaction => {
      transaction.setField('items', 'item_video', ['visual', 'opacity'], 0.75);
    });
    assert(edit.revision === 1n, 'Session edit did not advance to revision 1');
    assert(session.transaction.canUndo, 'Session edit was not undoable');
    session.transaction.undo();
    assert(session.transaction.canRedo, 'Session undo was not redoable');
    session.transaction.redo();
    const rendered = await session.preview.renderFrame({ timeUs: 250_000 });
    try {
      assert(
        rendered.bitmap.width === 16 && rendered.bitmap.height === 16,
        'Session preview has the wrong size',
      );
      assert(rendered.backend === 'webgl2', 'Session preview did not use WebGL2');
      return {
        revision: session.revision?.toString() ?? null,
        state: session.state,
        backend: rendered.backend,
        width: rendered.bitmap.width,
        height: rendered.bitmap.height,
      };
    } finally {
      rendered.bitmap.close();
    }
  } finally {
    await session.dispose();
  }
}

async function run() {
  assert(crossOriginIsolated, 'Consumer page is not cross-origin isolated');
  assert(typeof SharedArrayBuffer === 'function', 'SharedArrayBuffer is unavailable');
  assert(typeof Worker === 'function', 'Module Worker is unavailable');
  assert(typeof OffscreenCanvas === 'function', 'OffscreenCanvas is unavailable');
  assert(typeof VideoFrame === 'function', 'WebCodecs VideoFrame is unavailable');
  assert(typeof AudioContext === 'function', 'Web Audio AudioContext is unavailable');
  assert(typeof AudioWorkletNode === 'function', 'AudioWorkletNode is unavailable');
  const probeCanvas = new OffscreenCanvas(1, 1);
  assert(probeCanvas.getContext('webgl2') !== null, 'WebGL2 is unavailable');

  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    workerCompositor: await exerciseWorkerCompositor(),
    audioWorkletClock: await exerciseAudioWorkletClock(),
    sessionFacade: await exerciseSessionFacade(),
  };
}

publish({ status: 'running' });
try {
  publish({ status: 'passed', result: await run() });
} catch (error) {
  publish({ status: 'failed', error: errorDetails(error) });
}
