import { describe, expect, it } from 'vitest';

import { compileMaterialGraphToWebGl2, type MaterialGraph } from '@aelion/material-compiler';
import { WorkerCompositor } from '../src/index.js';
import type { RendererWorkerRequest, RendererWorkerRequestSetSnapshot } from '../src/protocol.js';
import { hasUsableWebGpu } from './browser-capabilities.js';

const crossDissolveGraph: MaterialGraph = {
  $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
  graphVersion: '1.0.0',
  nodeSet: 'aelion.visual.nodes/1.0.0',
  nodes: [
    {
      id: 'easedProgress',
      type: 'time.transition-curve',
      typeVersion: '1.0.0',
      inputs: {
        progress: { system: 'transitionProgress' },
        curve: { parameter: 'curve' },
      },
    },
    {
      id: 'mixFrames',
      type: 'composite.mix',
      typeVersion: '1.0.0',
      inputs: {
        a: { inputPort: 'from' },
        b: { inputPort: 'to' },
        amount: { node: 'easedProgress', output: 'value' },
      },
    },
  ],
  outputs: { result: { node: 'mixFrames', output: 'frame' } },
};

const warmFilmGraph: MaterialGraph = {
  $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
  graphVersion: '1.0.0',
  nodeSet: 'aelion.visual.nodes/1.0.0',
  nodes: [
    {
      id: 'warm',
      type: 'color.temperature',
      typeVersion: '1.0.0',
      inputs: { source: { inputPort: 'source' }, amount: { value: 0.12 } },
    },
    {
      id: 'fade',
      type: 'color.lift-black',
      typeVersion: '1.0.0',
      inputs: { source: { node: 'warm', output: 'frame' }, amount: { value: 0.035 } },
    },
    {
      id: 'mix',
      type: 'composite.mix',
      typeVersion: '1.0.0',
      inputs: {
        a: { inputPort: 'source' },
        b: { node: 'fade', output: 'frame' },
        amount: { parameter: 'intensity' },
      },
    },
  ],
  outputs: { result: { node: 'mix', output: 'frame' } },
};

const crossDissolve = compileMaterialGraphToWebGl2(crossDissolveGraph, {
  parameters: { curve: 'enum' },
  specializationValues: { curve: 'smooth' },
  inputPorts: { from: 'visual-frame', to: 'visual-frame' },
  systems: { transitionProgress: 'float' },
});

const warmFilm = compileMaterialGraphToWebGl2(warmFilmGraph, {
  parameters: { intensity: 'float' },
  inputPorts: { source: 'visual-frame' },
});

const softGlowGraph: MaterialGraph = {
  $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
  graphVersion: '1.0.0',
  nodeSet: 'aelion.visual.nodes/1.0.0',
  nodes: [
    {
      id: 'highlights',
      type: 'color.extract-highlights',
      typeVersion: '1.0.0',
      inputs: { source: { inputPort: 'source' }, threshold: { parameter: 'threshold' } },
    },
    {
      id: 'blurred',
      type: 'blur.gaussian',
      typeVersion: '1.0.0',
      inputs: {
        source: { node: 'highlights', output: 'frame' },
        radiusPx: { parameter: 'radiusPx' },
      },
    },
    {
      id: 'glow',
      type: 'color.scale-rgb',
      typeVersion: '1.0.0',
      inputs: {
        source: { node: 'blurred', output: 'frame' },
        scale: { parameter: 'intensity' },
      },
    },
    {
      id: 'composite',
      type: 'composite.screen',
      typeVersion: '1.0.0',
      inputs: {
        base: { inputPort: 'source' },
        overlay: { node: 'glow', output: 'frame' },
      },
    },
  ],
  outputs: { result: { node: 'composite', output: 'frame' } },
};

const softGlow = compileMaterialGraphToWebGl2(softGlowGraph, {
  parameters: { threshold: 'float', radiusPx: 'float', intensity: 'float' },
  inputPorts: { source: 'visual-frame' },
});

function solidFrame(red: number, green: number, blue: number): VideoFrame {
  const canvas = new OffscreenCanvas(8, 8);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.fillStyle = `rgb(${red} ${green} ${blue})`;
  context.fillRect(0, 0, 8, 8);
  return new VideoFrame(canvas, { timestamp: 0 });
}

function pixel(bitmap: ImageBitmap): readonly number[] {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(4, 4, 1, 1).data];
}

async function inspectWorkerRequests(worker: Worker): Promise<RendererWorkerRequestSetSnapshot> {
  const channel = new MessageChannel();
  const response = new Promise<RendererWorkerRequestSetSnapshot>((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error('Timed out inspecting renderer Worker request state')),
      2_000,
    );
    channel.port1.addEventListener(
      'message',
      (event: MessageEvent<RendererWorkerRequestSetSnapshot>) => {
        globalThis.clearTimeout(timeout);
        resolve(event.data);
      },
      { once: true },
    );
    channel.port1.start();
  });
  const request: RendererWorkerRequest = {
    type: 'inspect-resources',
    responsePort: channel.port2,
  };
  worker.postMessage(request, [channel.port2]);
  try {
    return await response;
  } finally {
    channel.port1.close();
  }
}

async function waitForWorkerRequestsToDrain(
  worker: Worker,
): Promise<RendererWorkerRequestSetSnapshot> {
  const deadline = performance.now() + 2_000;
  let snapshot = await inspectWorkerRequests(worker);
  while (snapshot.activeRequests !== 0 || snapshot.cancelledRequests !== 0) {
    if (performance.now() >= deadline) return snapshot;
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
    snapshot = await inspectWorkerRequests(worker);
  }
  return snapshot;
}

describe('Worker WebGL2 compositor', () => {
  it.each([
    [0, [255, 0, 0, 255]],
    [0.25, [215, 0, 40, 255]],
    [0.5, [128, 0, 128, 255]],
    [0.75, [40, 0, 215, 255]],
    [1, [0, 0, 255, 255]],
  ] as const)('matches cross-dissolve golden at progress %s', async (progress, expected) => {
    const compositor = new WorkerCompositor();
    const result = await compositor.compose({
      inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
      program: crossDissolve,
      parameters: {},
      systems: { transitionProgress: progress },
      preferredBackend: 'webgl2',
      width: 8,
      height: 8,
    });
    try {
      expect(result.backend).toBe('webgl2');
      expect(result.graphHash).toBe(crossDissolve.graphHash);
      const actual = pixel(result.bitmap);
      actual.forEach((channel, index) => {
        expect(Math.abs(channel - (expected[index] ?? 0))).toBeLessThanOrEqual(1);
      });
      expect(result.resources).toEqual({
        activeRequests: 0,
        cancelledRequests: 0,
        webgpuDevices: 0,
        webgpuPipelines: 0,
        webgpuBuffers: 0,
        webgpuTextures: 0,
        webgl2Contexts: 0,
        webgl2Programs: 0,
        webgl2Buffers: 0,
        webgl2Textures: 0,
        inputFrames: 0,
      });
      expect(result.outputBitmapOwner).toBe('caller');
    } finally {
      result.bitmap.close();
      compositor.dispose();
    }
  });

  it('executes a single-input filter compiled from the same Material Graph protocol', async () => {
    const compositor = new WorkerCompositor();
    const result = await compositor.compose({
      inputs: { source: solidFrame(100, 100, 100) },
      program: warmFilm,
      parameters: { intensity: 1 },
      preferredBackend: 'webgl2',
      width: 8,
      height: 8,
    });
    try {
      const actual = pixel(result.bitmap);
      expect(actual[0]).toBeGreaterThan(actual[2] ?? 0);
      expect(actual[0]).toBeGreaterThan(100);
      expect(result.graphHash).toBe(warmFilm.graphHash);
    } finally {
      result.bitmap.close();
      compositor.dispose();
    }
  });

  it('executes Soft Glow as four real WebGL2 passes with bounded intermediates', async () => {
    const canvas = new OffscreenCanvas(32, 32);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D context unavailable');
    context.fillStyle = 'rgb(10 10 10)';
    context.fillRect(0, 0, 32, 32);
    context.fillStyle = 'rgb(255 255 255)';
    context.fillRect(15, 15, 2, 2);
    const compositor = new WorkerCompositor();
    const result = await compositor.compose({
      inputs: { source: new VideoFrame(canvas, { timestamp: 0 }) },
      program: softGlow,
      parameters: { threshold: 0.7, radiusPx: 8, intensity: 1 },
      preferredBackend: 'webgl2',
      width: 32,
      height: 32,
    });
    try {
      const output = new OffscreenCanvas(32, 32);
      const outputContext = output.getContext('2d');
      if (outputContext === null) throw new Error('2D context unavailable');
      outputContext.drawImage(result.bitmap, 0, 0);
      const nearHighlight = outputContext.getImageData(13, 16, 1, 1).data;
      expect(nearHighlight[0]).toBeGreaterThan(10);
      expect(softGlow.passes).toHaveLength(4);
      expect(result.resources).toMatchObject({
        activeRequests: 0,
        cancelledRequests: 0,
        webgl2Contexts: 0,
        webgl2Programs: 0,
        webgl2Buffers: 0,
        webgl2Textures: 0,
        inputFrames: 0,
      });
    } finally {
      result.bitmap.close();
      compositor.dispose();
    }
  });

  it('rejects an already-aborted composition and closes transferred inputs', async () => {
    const compositor = new WorkerCompositor();
    const controller = new AbortController();
    controller.abort();
    await expect(
      compositor.compose({
        inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
        program: crossDissolve,
        parameters: {},
        systems: { transitionProgress: 0.5 },
        preferredBackend: 'webgl2',
        width: 8,
        height: 8,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/u);
    compositor.dispose();
  });

  it('cancels a transferred in-flight request without leaking its returned bitmap', async () => {
    const worker = new Worker(new URL('../src/webgl2-worker.js', import.meta.url), {
      type: 'module',
    });
    const compositor = new WorkerCompositor({ workerFactory: () => worker } as never);
    const controller = new AbortController();
    const pending = compositor.compose({
      inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
      program: crossDissolve,
      parameters: {},
      systems: { transitionProgress: 0.5 },
      width: 8,
      height: 8,
      preferredBackend: 'webgpu',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/u);
    expect(await waitForWorkerRequestsToDrain(worker)).toEqual({
      activeRequests: 0,
      cancelledRequests: 0,
    });
    compositor.dispose();
  });

  it('ignores late and unknown cancel messages instead of retaining their ids', async () => {
    const worker = new Worker(new URL('../src/webgl2-worker.js', import.meta.url), {
      type: 'module',
    });
    const compositor = new WorkerCompositor({ workerFactory: () => worker } as never);
    const result = await compositor.compose({
      inputs: { source: solidFrame(100, 100, 100) },
      program: warmFilm,
      parameters: { intensity: 1 },
      preferredBackend: 'webgl2',
      width: 8,
      height: 8,
    });
    result.bitmap.close();

    for (let id = 1; id <= 1_000; id += 1) {
      const request: RendererWorkerRequest = { type: 'cancel', id };
      worker.postMessage(request);
    }
    expect(await inspectWorkerRequests(worker)).toEqual({
      activeRequests: 0,
      cancelledRequests: 0,
    });
    compositor.dispose();
  });

  it('applies explicit backpressure instead of growing the Worker queue without bound', async () => {
    const compositor = new WorkerCompositor({ maxPendingRequests: 1 });
    const first = compositor.compose({
      inputs: { source: solidFrame(100, 100, 100) },
      program: softGlow,
      parameters: { threshold: 0.7, radiusPx: 8, intensity: 1 },
      preferredBackend: 'webgl2',
      width: 1024,
      height: 1024,
    });
    await expect(
      compositor.compose({
        inputs: { source: solidFrame(100, 100, 100) },
        program: softGlow,
        parameters: { threshold: 0.7, radiusPx: 8, intensity: 1 },
        preferredBackend: 'webgl2',
        width: 1024,
        height: 1024,
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'RENDERER_QUEUE_FULL' })],
    });
    const result = await first;
    result.bitmap.close();
    expect(compositor.snapshot()).toMatchObject({
      pendingRequests: 0,
      maxPendingRequests: 1,
    });
    compositor.dispose();
  });

  it('uses the Worker WebGPU primary path when an adapter is usable', async () => {
    if (!(await hasUsableWebGpu())) return;
    const compositor = new WorkerCompositor();
    const result = await compositor.compose({
      inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
      program: crossDissolve,
      parameters: {},
      systems: { transitionProgress: 0.5 },
      width: 8,
      height: 8,
      preferredBackend: 'webgpu',
      allowFallback: false,
    });
    try {
      expect(result.backend).toBe('webgpu');
      const actual = pixel(result.bitmap);
      expect(actual[0]).toBeGreaterThanOrEqual(126);
      expect(actual[0]).toBeLessThanOrEqual(129);
      expect(actual[2]).toBeGreaterThanOrEqual(126);
      expect(actual[2]).toBeLessThanOrEqual(129);
    } finally {
      result.bitmap.close();
      compositor.dispose();
    }
  });

  it('executes the same single-input Filter graph through WebGPU', async () => {
    if (!(await hasUsableWebGpu())) return;
    const compositor = new WorkerCompositor();
    const result = await compositor.compose({
      inputs: { source: solidFrame(100, 100, 100) },
      program: warmFilm,
      parameters: { intensity: 1 },
      width: 8,
      height: 8,
      preferredBackend: 'webgpu',
      allowFallback: false,
    });
    try {
      expect(result.backend).toBe('webgpu');
      const actual = pixel(result.bitmap);
      expect(actual[0]).toBeGreaterThan(actual[2] ?? 0);
      expect(actual[0]).toBeGreaterThan(100);
    } finally {
      result.bitmap.close();
      compositor.dispose();
    }
  });

  it('recovers a lost WebGPU device through the explicit WebGL2 fallback', async () => {
    if (!(await hasUsableWebGpu())) return;
    const compositor = new WorkerCompositor();
    const result = await compositor.compose({
      inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
      program: crossDissolve,
      parameters: {},
      systems: { transitionProgress: 0.5 },
      width: 8,
      height: 8,
      preferredBackend: 'webgpu',
      allowFallback: true,
      debugSimulateLoss: 'webgpu-device',
    });
    try {
      expect(result.backend).toBe('webgl2');
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'RENDERER_WEBGPU_DEVICE_LOST' }),
      ]);
      expect(result.resources).toMatchObject({
        activeRequests: 0,
        cancelledRequests: 0,
        webgpuDevices: 0,
        webgpuBuffers: 0,
        webgpuTextures: 0,
        webgl2Contexts: 0,
        webgl2Programs: 0,
        webgl2Buffers: 0,
        webgl2Textures: 0,
        inputFrames: 0,
      });
    } finally {
      result.bitmap.close();
      compositor.dispose();
    }
  });

  it('returns stable diagnostics when backend loss has no allowed fallback', async () => {
    const webgl = new WorkerCompositor();
    await expect(
      webgl.compose({
        inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
        program: crossDissolve,
        parameters: {},
        systems: { transitionProgress: 0.5 },
        width: 8,
        height: 8,
        preferredBackend: 'webgl2',
        allowFallback: false,
        debugSimulateLoss: 'webgl2-context',
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'RENDERER_WEBGL_CONTEXT_LOST' })],
    });
    expect(webgl.snapshot().pendingRequests).toBe(0);
    webgl.dispose();

    if (!(await hasUsableWebGpu())) return;
    const webgpu = new WorkerCompositor();
    await expect(
      webgpu.compose({
        inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
        program: crossDissolve,
        parameters: {},
        systems: { transitionProgress: 0.5 },
        width: 8,
        height: 8,
        preferredBackend: 'webgpu',
        allowFallback: false,
        debugSimulateLoss: 'webgpu-device',
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'RENDERER_WEBGPU_DEVICE_LOST' })],
    });
    expect(webgpu.snapshot().pendingRequests).toBe(0);
    webgpu.dispose();
  });

  it('releases Worker GPU resources across repeated compositor sessions', async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const compositor = new WorkerCompositor();
      const result = await compositor.compose({
        inputs: { from: solidFrame(255, 0, 0), to: solidFrame(0, 0, 255) },
        program: crossDissolve,
        parameters: {},
        systems: { transitionProgress: 0.5 },
        width: 8,
        height: 8,
        preferredBackend: iteration % 2 === 0 ? 'webgpu' : 'webgl2',
      });
      result.bitmap.close();
      compositor.dispose();
      expect(compositor.disposed).toBe(true);
    }
  });
});
