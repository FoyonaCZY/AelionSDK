import { renderIrAudio, SharedPcmRingBuffer } from '@aelion/audio';
import { exportWebM, SeekableMemorySink } from '@aelion/export';
import { compileMaterialGraphToWebGl2, type MaterialGraph } from '@aelion/material-compiler';
import { IncrementalRenderCompiler } from '@aelion/render-ir';
import { WorkerCompositor } from '@aelion/renderer-worker';
import type { AelionProject } from '@aelion/project-schema';

import { measureLongTasksDuring, sliceLongTaskWindow } from './long-task-window.js';

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

function solidFrame(width: number, height: number, value: number): VideoFrame {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.fillStyle = `rgb(${value} ${value} ${value})`;
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgb(255 255 255)';
  context.fillRect(width / 2 - 8, height / 2 - 8, 16, 16);
  return new VideoFrame(canvas, { timestamp: 0 });
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function memorySnapshot(): Record<string, number | null> {
  const memory = Reflect.get(performance, 'memory') as
    | { readonly usedJSHeapSize?: number; readonly totalJSHeapSize?: number }
    | undefined;
  return {
    usedJsHeapBytes: memory?.usedJSHeapSize ?? null,
    totalJsHeapBytes: memory?.totalJSHeapSize ?? null,
  };
}

async function materialBenchmark(
  label: string,
  graph: MaterialGraph,
  parameters: Readonly<Record<string, number>>,
  iterations: number,
  preferredBackend: 'webgpu' | 'webgl2',
): Promise<Record<string, unknown>> {
  const program = compileMaterialGraphToWebGl2(graph, {
    parameters: Object.fromEntries(Object.keys(parameters).map(id => [id, 'float' as const])),
    inputPorts: { source: 'visual-frame' },
  });
  const compositor = new WorkerCompositor();
  const wallMs: number[] = [];
  const workerUs: number[] = [];
  const gpuUs: number[] = [];
  const before = memorySnapshot();
  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const startedAt = performance.now();
      const result = await compositor.compose({
        inputs: { source: solidFrame(1920, 1080, 32) },
        program,
        parameters,
        preferredBackend,
        width: 1920,
        height: 1080,
      });
      wallMs.push(performance.now() - startedAt);
      workerUs.push(result.timing.totalWorkerUs);
      gpuUs.push(result.timing.gpuCompletionUs);
      result.bitmap.close();
    }
    const resourcesBeforeDispose = compositor.snapshot();
    compositor.dispose();
    return {
      label,
      resolution: { width: 1920, height: 1080 },
      frames: wallMs.length,
      passCount: program.executionPlan.passes.length,
      intermediateTextureCount: program.executionPlan.intermediateTextureCount,
      wall: { p50Ms: percentile(wallMs, 0.5), p95Ms: percentile(wallMs, 0.95) },
      worker: { p50Us: percentile(workerUs, 0.5), p95Us: percentile(workerUs, 0.95) },
      gpuCompletion: { p50Us: percentile(gpuUs, 0.5), p95Us: percentile(gpuUs, 0.95) },
      throughputFps: 1_000 / percentile(wallMs, 0.5),
      resourcesBeforeDispose,
      resourcesAfterDispose: compositor.snapshot(),
      memory: { before, after: memorySnapshot() },
    };
  } finally {
    compositor.dispose();
  }
}

async function exportBenchmark(): Promise<Record<string, unknown>> {
  const sink = new SeekableMemorySink();
  const before = memorySnapshot();
  const phases: { readonly name: string; readonly atMs: number }[] = [];
  const mark = (name: string): void => {
    phases.push({ name, atMs: performance.now() });
  };
  let renderedVideoFrames = 0;
  let renderedAudioBlocks = 0;
  const measured = await measureLongTasksDuring(async () => {
    mark('export-call');
    const result = await exportWebM({
      durationUs: 5_000_000,
      width: 1920,
      height: 1080,
      frameRate: { numerator: 30, denominator: 1 },
      sampleRate: 48_000,
      channelCount: 2,
      videoBitrate: 4_000_000,
      audioBitrate: 128_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: request => {
        if (renderedVideoFrames === 0) mark('first-video-render-start');
        if (renderedVideoFrames === 1) mark('second-video-render-start');
        const canvas = new OffscreenCanvas(request.width, request.height);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2D context unavailable');
        const amount = request.frameIndex % 255;
        context.fillStyle = `rgb(${amount} 64 ${255 - amount})`;
        context.fillRect(0, 0, request.width, request.height);
        const frame = new VideoFrame(canvas, {
          timestamp: request.timestampUs,
          duration: request.durationUs,
        });
        renderedVideoFrames += 1;
        if (renderedVideoFrames === 1) mark('first-video-render-end');
        return Promise.resolve(frame);
      },
      renderAudio: request => {
        if (renderedAudioBlocks === 0) mark('first-audio-render-start');
        const pcm = new Float32Array(request.frameCount * request.channelCount);
        renderedAudioBlocks += 1;
        if (renderedAudioBlocks === 1) mark('first-audio-render-end');
        return Promise.resolve(pcm);
      },
      onProgress: progress => {
        if (progress >= 0.5 && !phases.some(value => value.name === 'video-complete')) {
          mark('video-complete');
        }
      },
    });
    mark('export-complete');
    return result;
  });
  const result = measured.value;
  const elapsedMs = measured.window.elapsedMs;
  const steadyStartedAtMs = phases.find(phase => phase.name === 'second-video-render-start')?.atMs;
  if (steadyStartedAtMs === undefined) {
    throw new Error('Performance export did not reach the steady-state frame boundary');
  }
  const mainThread = {
    contract: 'codec-initialization-disclosed; steady-state begins at the second video frame',
    initialization: sliceLongTaskWindow(
      measured.window,
      measured.window.startedAtMs,
      steadyStartedAtMs,
    ),
    steady: sliceLongTaskWindow(measured.window, steadyStartedAtMs, measured.window.completedAtMs),
    overall: measured.window,
  };
  const bytes = sink.finalize().byteLength;
  return {
    resolution: { width: 1920, height: 1080 },
    durationUs: result.durationUs,
    videoFrames: result.videoFrames,
    audioFrames: result.audioFrames,
    elapsedMs,
    realtimeMultiple: result.durationUs / 1_000 / elapsedMs,
    bytes,
    sink: sink.snapshot(),
    mainThread,
    phases,
    memory: { before, after: memorySnapshot() },
  };
}

async function longTimelineSimulation(project: AelionProject): Promise<Record<string, unknown>> {
  const ir = new IncrementalRenderCompiler().compile(project, 'seq_vertical', 0n).ir;
  const ring = SharedPcmRingBuffer.allocate(4_096, 2, 48_000);
  const block = new Float32Array(128 * 2);
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  const before = memorySnapshot();
  const startedAt = performance.now();
  const totalQuanta = (48_000 * 60 * 10) / 128;
  const heapSamples: { equivalentMinute: number; usedJsHeapBytes: number | null }[] = [];
  const quantaPerMinute = (48_000 * 60) / 128;
  for (let index = 0; index < totalQuanta; index += 1) {
    ring.writeInterleaved(block);
    ring.readPlanar([left, right]);
    if ((index + 1) % quantaPerMinute === 0) {
      heapSamples.push({
        equivalentMinute: (index + 1) / quantaPerMinute,
        usedJsHeapBytes: memorySnapshot().usedJsHeapBytes ?? null,
      });
    }
  }
  const mixed = await renderIrAudio({
    ir,
    startFrame: 0,
    frameCount: 1_024,
    channelCount: 2,
    source: {
      pcmRange: (_assetId, _streamIndex, _startUs, durationUs) => {
        const frameCount = Math.ceil((durationUs * 48_000) / 1_000_000);
        return Promise.resolve({
          sampleRate: 48_000,
          channelCount: 2,
          frameCount,
          interleaved: new Float32Array(frameCount * 2),
        });
      },
    },
  });
  mixed.fill(0);
  return {
    simulatedDurationUs: 600_000_000,
    elapsedMs: performance.now() - startedAt,
    pcm: ring.snapshot(),
    boundedBytes: ring.buffer.byteLength,
    heapSamples,
    memory: { before, after: memorySnapshot() },
  };
}

async function run(): Promise<Record<string, unknown>> {
  const [softGlow, warmFilm, project] = await Promise.all([
    json<MaterialGraph>('/examples/materials/soft-glow/graphs/soft-glow.graph.json'),
    json<MaterialGraph>('/examples/materials/warm-film/graphs/warm-film.graph.json'),
    json<AelionProject>('/examples/aelion-vertical-slice-30s.project.json'),
  ]);
  const warmFilmWebGpu = await materialBenchmark(
    'Warm Film single-pass WebGPU',
    warmFilm,
    { intensity: 0.65 },
    30,
    'webgpu',
  );
  const warmFilmWebGl2 = await materialBenchmark(
    'Warm Film single-pass WebGL2',
    warmFilm,
    { intensity: 0.65 },
    30,
    'webgl2',
  );
  const softGlowResult = await materialBenchmark(
    'Soft Glow four-pass WebGL2',
    softGlow,
    { threshold: 0.7, radiusPx: 12, intensity: 0.8 },
    12,
    'webgl2',
  );
  const exportResult = await exportBenchmark();
  const longTimeline = await longTimelineSimulation(project);
  return {
    evidenceVersion: '1.0.0',
    fixture: 'Aelion 1080p30 SDR reference',
    material: {
      warmFilmWebGpu,
      warmFilmWebGl2,
      softGlow: softGlowResult,
      resourceOwnership: {
        policy: 'each benchmark compositor is disposed and reports zero pending requests',
      },
    },
    export: exportResult,
    longTimeline,
    userAgent: navigator.userAgent,
  };
}

void run()
  .then(report => {
    Reflect.set(globalThis, '__AELION_PERFORMANCE_EVIDENCE__', report);
  })
  .catch((error: unknown) => {
    Reflect.set(
      globalThis,
      '__AELION_PERFORMANCE_ERROR__',
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    );
  });
