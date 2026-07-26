import { renderIrAudio, SharedPcmRingBuffer } from '@aelion/audio';
import {
  exportMp4,
  exportMuxedInWorker,
  OpfsSeekableSink,
  preflightProfileExport,
  SeekableMemorySink,
} from '@aelion/export';
import { compileMaterialGraphToWebGl2, type MaterialGraph } from '@aelion/material-compiler';
import { createSampleIndex } from '@aelion/media';
import { IncrementalRenderCompiler } from '@aelion/render-ir';
import { WorkerCompositor } from '@aelion/renderer-worker';
import { Aelion, ByteMediaProvider, createProject } from '@aelion/sdk';
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

function timingSummary(values: readonly number[]): Record<string, unknown> {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maximumMs: Math.max(0, ...values),
    meanMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    samplesMs: values,
  };
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

function nonEmptyOrNull(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status.toString()}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function codecSupport(): Promise<Record<string, unknown>> {
  const video = async (config: VideoEncoderConfig): Promise<boolean | null> => {
    if (typeof VideoEncoder !== 'function') return null;
    try {
      return (await VideoEncoder.isConfigSupported(config)).supported ?? false;
    } catch {
      return false;
    }
  };
  const audio = async (config: AudioEncoderConfig): Promise<boolean | null> => {
    if (typeof AudioEncoder !== 'function') return null;
    try {
      return (await AudioEncoder.isConfigSupported(config)).supported ?? false;
    } catch {
      return false;
    }
  };
  const navigatorWithMemory = navigator as Navigator & {
    readonly deviceMemory?: number;
  };
  const gpu = Reflect.get(navigator, 'gpu') as
    | {
        requestAdapter(): Promise<{
          readonly isFallbackAdapter?: boolean;
          readonly info?: {
            readonly vendor?: string;
            readonly architecture?: string;
            readonly device?: string;
            readonly description?: string;
          };
        } | null>;
      }
    | undefined;
  let adapter: {
    readonly isFallbackAdapter?: boolean;
    readonly info?: {
      readonly vendor?: string;
      readonly architecture?: string;
      readonly device?: string;
      readonly description?: string;
    };
  } | null = null;
  try {
    adapter = (await gpu?.requestAdapter()) ?? null;
  } catch {
    adapter = null;
  }
  return {
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    webCodecs: {
      videoEncoder: typeof VideoEncoder === 'function',
      audioEncoder: typeof AudioEncoder === 'function',
      h264_1080p30: await video({
        codec: 'avc1.640028',
        width: 1_920,
        height: 1_080,
        framerate: 30,
        bitrate: 4_000_000,
      }),
      h264_4k30: await video({
        codec: 'avc1.640033',
        width: 3_840,
        height: 2_160,
        framerate: 30,
        bitrate: 12_000_000,
      }),
      vp9_1080p30: await video({
        codec: 'vp09.00.10.08',
        width: 1_920,
        height: 1_080,
        framerate: 30,
        bitrate: 4_000_000,
      }),
      vp9_4k30: await video({
        codec: 'vp09.00.10.08',
        width: 3_840,
        height: 2_160,
        framerate: 30,
        bitrate: 12_000_000,
      }),
      av1_1080p30: await video({
        codec: 'av01.0.08M.08',
        width: 1_920,
        height: 1_080,
        framerate: 30,
        bitrate: 4_000_000,
      }),
      hevc_1080p30: await video({
        codec: 'hvc1.1.6.L120.B0',
        width: 1_920,
        height: 1_080,
        framerate: 30,
        bitrate: 4_000_000,
        hevc: { format: 'hevc' },
      } as VideoEncoderConfig),
      aacStereo: await audio({
        codec: 'mp4a.40.2',
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: 128_000,
      }),
      opusStereo: await audio({
        codec: 'opus',
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: 128_000,
      }),
    },
    webGpu: {
      apiAvailable: gpu !== undefined,
      adapterAvailable: adapter !== null,
      fallbackAdapter: adapter?.isFallbackAdapter ?? null,
      adapterInfo:
        adapter === null
          ? null
          : {
              vendor: nonEmptyOrNull(adapter.info?.vendor),
              architecture: nonEmptyOrNull(adapter.info?.architecture),
              device: nonEmptyOrNull(adapter.info?.device),
              description: nonEmptyOrNull(adapter.info?.description),
            },
    },
  };
}

async function materialBenchmark(
  label: string,
  graph: MaterialGraph,
  parameters: Readonly<Record<string, number>>,
  iterations: number,
  preferredBackend: 'webgpu' | 'webgl2',
  resolution: { readonly width: number; readonly height: number } = {
    width: 1_920,
    height: 1_080,
  },
): Promise<Record<string, unknown>> {
  const program = compileMaterialGraphToWebGl2(graph, {
    parameters: Object.fromEntries(Object.keys(parameters).map(id => [id, 'float' as const])),
    inputPorts: { source: 'visual-frame' },
  });
  const compositor = new WorkerCompositor();
  const wallMs: number[] = [];
  const workerUs: number[] = [];
  const gpuUs: number[] = [];
  const warmupFrames = 3;
  const before = memorySnapshot();
  try {
    for (let iteration = 0; iteration < warmupFrames; iteration += 1) {
      const result = await compositor.compose({
        inputs: { source: solidFrame(resolution.width, resolution.height, 32) },
        program,
        parameters,
        preferredBackend,
        width: resolution.width,
        height: resolution.height,
      });
      result.bitmap.close();
    }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const startedAt = performance.now();
      const result = await compositor.compose({
        inputs: { source: solidFrame(resolution.width, resolution.height, 32) },
        program,
        parameters,
        preferredBackend,
        width: resolution.width,
        height: resolution.height,
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
      resolution,
      backend: preferredBackend,
      warmupFrames,
      frames: wallMs.length,
      passCount: program.executionPlan.passes.length,
      intermediateTextureCount: program.executionPlan.intermediateTextureCount,
      wall: {
        p50Ms: percentile(wallMs, 0.5),
        p95Ms: percentile(wallMs, 0.95),
        maximumMs: Math.max(0, ...wallMs),
        samplesMs: wallMs,
      },
      worker: {
        p50Us: percentile(workerUs, 0.5),
        p95Us: percentile(workerUs, 0.95),
        maximumUs: Math.max(0, ...workerUs),
        samplesUs: workerUs,
      },
      gpuCompletion: {
        p50Us: percentile(gpuUs, 0.5),
        p95Us: percentile(gpuUs, 0.95),
        maximumUs: Math.max(0, ...gpuUs),
        samplesUs: gpuUs,
      },
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
    const result = await exportMuxedInWorker({
      profile: 'webm',
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
    contract:
      'worker encoder/mux orchestration; host frame production disclosed; steady-state begins at the second video frame',
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

function denseProject(clipCount: number, trackCount: number): AelionProject {
  const clipDurationUs = 100_000;
  const durationUs = Math.ceil(clipCount / trackCount) * clipDurationUs;
  const builder = createProject({
    projectId: `performance_${clipCount.toString()}_${trackCount.toString()}`,
    sequenceId: 'main',
    width: 1_920,
    height: 1_080,
    frameRate: { numerator: 30, denominator: 1 },
    durationUs,
  });
  builder.addAsset({ id: 'still', kind: 'image', mimeType: 'image/png' });
  const tracks = Array.from({ length: trackCount }, (_, index) =>
    builder.addTrack({ id: `track_${index.toString()}`, kind: 'visual' }),
  );
  for (let index = 0; index < clipCount; index += 1) {
    const row = Math.floor(index / trackCount);
    const trackId = tracks[index % trackCount];
    if (trackId === undefined) throw new Error('Dense benchmark track assignment failed');
    builder.addImageClip({
      id: `clip_${index.toString()}`,
      assetId: 'still',
      trackId,
      atUs: row * clipDurationUs,
      durationUs: clipDurationUs,
      fit: 'fill',
    });
  }
  return builder.build();
}

function compilationBenchmark(): Record<string, unknown> {
  const cases = [
    { clipCount: 10, trackCount: 2, coldRuns: 20, warmRuns: 50 },
    { clipCount: 100, trackCount: 8, coldRuns: 12, warmRuns: 30 },
    { clipCount: 1_000, trackCount: 32, coldRuns: 7, warmRuns: 20 },
  ];
  return {
    definition:
      'Project build is measured once; cold compilation creates a new compiler; warm compilation reuses immutable indexes for a new revision with an explicitly empty affected set.',
    cases: cases.map(definition => {
      const buildStarted = performance.now();
      const project = denseProject(definition.clipCount, definition.trackCount);
      const buildMs = performance.now() - buildStarted;
      const coldMs: number[] = [];
      let coldStats: unknown;
      for (let index = 0; index < definition.coldRuns; index += 1) {
        const started = performance.now();
        const result = new IncrementalRenderCompiler().compile(project, 'main', 0n);
        coldMs.push(performance.now() - started);
        coldStats = result.stats;
      }
      const compiler = new IncrementalRenderCompiler();
      compiler.compile(project, 'main', 0n);
      const warmMs: number[] = [];
      let warmStats: unknown;
      for (let index = 0; index < definition.warmRuns; index += 1) {
        const started = performance.now();
        const result = compiler.compile(project, 'main', BigInt(index + 1), {
          affectedEntityIds: [],
        });
        warmMs.push(performance.now() - started);
        warmStats = result.stats;
      }
      return {
        clipCount: definition.clipCount,
        trackCount: definition.trackCount,
        projectJsonBytes: new TextEncoder().encode(JSON.stringify(project)).byteLength,
        buildMs,
        cold: { ...timingSummary(coldMs), stats: coldStats },
        warmIncremental: { ...timingSummary(warmMs), stats: warmStats },
      };
    }),
  };
}

async function profilePreflightBenchmark(): Promise<Record<string, unknown>> {
  const project = denseProject(1, 1);
  const ir = new IncrementalRenderCompiler().compile(project, 'main', 0n).ir;
  const cases = [];
  for (const profile of ['webm-vp9-opus', 'mp4-h264-aac', 'mp4-av1-aac', 'mp4-hevc-aac'] as const) {
    const sink = new SeekableMemorySink();
    const started = performance.now();
    const result = await preflightProfileExport({
      ir,
      projectRevision: ir.revision,
      profile,
      sink: sink.writable,
      videoBitrate: 4_000_000,
      audioBitrate: 128_000,
    });
    cases.push({
      profile,
      elapsedMs: performance.now() - started,
      ok: result.ok,
      issues: result.issues.map(issue => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        recoverable: issue.recoverable,
      })),
      encoderConfiguration: result.encoderConfiguration ?? null,
    });
    sink.cleanup();
  }
  return {
    definition:
      'Public profile preflight on a 1080p30 stereo Render IR, including runtime codec verification and no export writes.',
    cases,
  };
}

async function audioBenchmark(project: AelionProject): Promise<Record<string, unknown>> {
  const ir = new IncrementalRenderCompiler().compile(project, 'seq_vertical', 0n).ir;
  const blockFrames = 1_024;
  const iterations = 120;
  const latenciesMs: number[] = [];
  const before = memorySnapshot();
  const source = {
    pcmRange: (_assetId: string, _streamIndex: number, _startUs: number, durationUs: number) => {
      const frameCount = Math.ceil((durationUs * ir.sampleRate) / 1_000_000);
      return Promise.resolve({
        sampleRate: ir.sampleRate,
        channelCount: 2,
        frameCount,
        interleaved: new Float32Array(frameCount * 2),
      });
    },
  };
  await renderIrAudio({
    ir,
    startFrame: 0,
    frameCount: blockFrames,
    channelCount: 2,
    source,
  });
  let checksum = 0;
  const started = performance.now();
  const projectFrames = Math.max(blockFrames, Math.floor((ir.durationUs * ir.sampleRate) / 1e6));
  for (let index = 0; index < iterations; index += 1) {
    const blockStarted = performance.now();
    const result = await renderIrAudio({
      ir,
      startFrame: (index * blockFrames) % (projectFrames - blockFrames + 1),
      frameCount: blockFrames,
      channelCount: 2,
      source,
    });
    latenciesMs.push(performance.now() - blockStarted);
    checksum += result[0] ?? 0;
  }
  const elapsedMs = performance.now() - started;
  const renderedDurationSeconds = (iterations * blockFrames) / ir.sampleRate;
  return {
    sampleRate: ir.sampleRate,
    channelCount: 2,
    blockFrames,
    iterations,
    renderedDurationSeconds,
    elapsedMs,
    realtimeMultiple: renderedDurationSeconds / (elapsedMs / 1_000),
    blockLatency: timingSummary(latenciesMs),
    audioTrackCount: ir.tracks.filter(track => track.kind === 'audio').length,
    audioClipCount: ir.tracks
      .filter(track => track.kind === 'audio')
      .reduce((count, track) => count + track.clips.length, 0),
    checksum,
    memory: { before, after: memorySnapshot() },
  };
}

interface ExportMatrixCase {
  readonly id: string;
  readonly profile: 'webm-vp9-opus' | 'mp4-h264-aac';
  readonly width: number;
  readonly height: number;
  readonly durationUs: number;
  readonly videoBitrate: number;
  readonly trialCount: number;
}

async function exportMatrixTrial(
  definition: ExportMatrixCase,
  trial: number,
): Promise<Record<string, unknown>> {
  const sink = new SeekableMemorySink();
  const canvas = new OffscreenCanvas(definition.width, definition.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D export canvas unavailable');
  const before = memorySnapshot();
  try {
    const measured = await measureLongTasksDuring(async () => {
      const options = {
        durationUs: definition.durationUs,
        width: definition.width,
        height: definition.height,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: definition.videoBitrate,
        audioBitrate: 128_000,
        sink: sink.writable,
        cleanupSink: () => sink.cleanup(),
        renderFrame: (request: {
          readonly frameIndex: number;
          readonly timestampUs: number;
          readonly durationUs: number;
        }) => {
          const phase = request.frameIndex % 255;
          context.fillStyle = `rgb(${phase} 64 ${255 - phase})`;
          context.fillRect(0, 0, definition.width, definition.height);
          context.fillStyle = '#ffffff';
          context.fillRect(
            (request.frameIndex * 17) % definition.width,
            definition.height / 2,
            24,
            24,
          );
          return Promise.resolve(
            new VideoFrame(canvas, {
              timestamp: request.timestampUs,
              duration: request.durationUs,
            }),
          );
        },
        renderAudio: (request: { readonly frameCount: number; readonly channelCount: number }) =>
          Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
      };
      return definition.profile === 'mp4-h264-aac'
        ? exportMp4(options)
        : exportMuxedInWorker({ ...options, profile: 'webm' });
    });
    const bytes = sink.finalize();
    const isMp4 = definition.profile === 'mp4-h264-aac';
    const headerValid = isMp4
      ? new TextDecoder().decode(bytes.subarray(4, 8)) === 'ftyp'
      : bytes.length >= 4 &&
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3;
    return {
      trial,
      status: 'completed',
      elapsedMs: measured.window.elapsedMs,
      realtimeMultiple: definition.durationUs / 1_000 / measured.window.elapsedMs,
      videoFrames: measured.value.videoFrames,
      audioFrames: measured.value.audioFrames,
      bytes: bytes.byteLength,
      headerValid,
      mimeType: measured.value.mimeType,
      encoderConfiguration: measured.value.encoderConfiguration,
      sink: sink.snapshot(),
      mainThread: measured.window,
      memory: { before, after: memorySnapshot() },
    };
  } catch (error) {
    sink.cleanup();
    return {
      trial,
      status: 'unsupported-or-failed',
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'UnknownError', message: String(error) },
      memory: { before, after: memorySnapshot() },
    };
  }
}

async function exportMatrixBenchmark(): Promise<Record<string, unknown>> {
  const definitions: readonly ExportMatrixCase[] = [
    {
      id: 'webm-720p30',
      profile: 'webm-vp9-opus',
      width: 1_280,
      height: 720,
      durationUs: 3_000_000,
      videoBitrate: 2_500_000,
      trialCount: 2,
    },
    {
      id: 'webm-1080p30',
      profile: 'webm-vp9-opus',
      width: 1_920,
      height: 1_080,
      durationUs: 3_000_000,
      videoBitrate: 4_000_000,
      trialCount: 2,
    },
    {
      id: 'mp4-1080p30',
      profile: 'mp4-h264-aac',
      width: 1_920,
      height: 1_080,
      durationUs: 3_000_000,
      videoBitrate: 4_000_000,
      trialCount: 2,
    },
    {
      id: 'webm-4k30',
      profile: 'webm-vp9-opus',
      width: 3_840,
      height: 2_160,
      durationUs: 1_000_000,
      videoBitrate: 12_000_000,
      trialCount: 1,
    },
    {
      id: 'mp4-4k30',
      profile: 'mp4-h264-aac',
      width: 3_840,
      height: 2_160,
      durationUs: 1_000_000,
      videoBitrate: 12_000_000,
      trialCount: 1,
    },
  ];
  const cases = [];
  for (const definition of definitions) {
    const trials = [];
    for (let trial = 1; trial <= definition.trialCount; trial += 1) {
      trials.push(await exportMatrixTrial(definition, trial));
    }
    const completed = trials.filter(value => value.status === 'completed');
    const elapsed = completed
      .map(value => value.elapsedMs)
      .filter((value): value is number => typeof value === 'number');
    cases.push({
      ...definition,
      completedTrials: completed.length,
      timing: elapsed.length === 0 ? null : timingSummary(elapsed),
      trials,
    });
  }
  return {
    definition:
      'Generated Canvas frames plus silence; setup, encoding, muxing, sink close and final contiguous memory assembly are timed. No input media decode is included.',
    order: definitions.map(value => value.id),
    cases,
  };
}

async function realMediaPipelineBenchmark(): Promise<Record<string, unknown>> {
  const input = await bytes('/fixtures/media/mp4-moov-head-h264-aac.mp4');
  const sourceIndex = await createSampleIndex(input);
  const definitions = [
    { id: 'real-mp4-1080p30', width: 1_920, height: 1_080, bitrate: 4_000_000 },
    { id: 'real-mp4-4k30', width: 3_840, height: 2_160, bitrate: 12_000_000 },
  ] as const;
  const cases: Record<string, unknown>[] = [];
  for (const definition of definitions) {
    const assetId = 'fixture';
    const media = new ByteMediaProvider({
      maxCachedBytes: 4 * 1_024 * 1_024,
      resolveAssetBytes: () => Promise.resolve(input),
    });
    const builder = createProject({
      projectId: `pipeline_${definition.width.toString()}x${definition.height.toString()}`,
      sequenceId: 'main',
      width: definition.width,
      height: definition.height,
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
    });
    builder.addAsset({
      id: assetId,
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: input.byteLength,
    });
    const visualTrack = builder.addTrack({ id: 'video', kind: 'visual' });
    const audioTrack = builder.addTrack({ id: 'audio', kind: 'audio' });
    builder.addMediaClip({
      id: 'video-clip',
      kind: 'video',
      assetId,
      trackId: visualTrack,
      durationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
      fit: 'fill',
    });
    builder.addMediaClip({
      id: 'audio-clip',
      kind: 'audio',
      assetId,
      trackId: audioTrack,
      durationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
    });
    const session = await Aelion.createSession({
      media,
      preferredBackend: 'webgl2',
      allowBackendFallback: false,
    });
    const sink = new SeekableMemorySink();
    const before = memorySnapshot();
    try {
      await session.loadProject(builder.build());
      const preflight = await session.export.preflightProfile({
        profile: 'mp4-h264-aac',
        sink: sink.writable,
        videoBitrate: definition.bitrate,
        audioBitrate: 128_000,
      });
      if (!preflight.ok) {
        cases.push({
          ...definition,
          status: 'unsupported',
          preflight: {
            ok: false,
            issues: preflight.issues.map(issue => ({
              code: issue.code,
              message: issue.message,
            })),
          },
        });
        continue;
      }
      const measured = await measureLongTasksDuring(() =>
        session.export.startProfile({
          profile: 'mp4-h264-aac',
          sink: sink.writable,
          videoBitrate: definition.bitrate,
          audioBitrate: 128_000,
        }),
      );
      const output = sink.finalize();
      const outputIndex = await createSampleIndex(output);
      if (definition.width === 1_920) {
        Reflect.set(globalThis, '__AELION_PERFORMANCE_MP4_READBACK__', output);
      }
      const video = outputIndex.tracks.find(track => track.kind === 'video');
      const audio = outputIndex.tracks.find(track => track.kind === 'audio');
      cases.push({
        ...definition,
        status: 'completed',
        stages: ['decode', 'render', 'audio', 'encode', 'mux', 'sink'],
        elapsedMs: measured.window.elapsedMs,
        realtimeMultiple: 1_000 / measured.window.elapsedMs,
        outputBytes: output.byteLength,
        input: {
          container: sourceIndex.container,
          bytes: input.byteLength,
          videoCodec: sourceIndex.tracks.find(track => track.kind === 'video')?.codecFamily,
          audioCodec: sourceIndex.tracks.find(track => track.kind === 'audio')?.codecFamily,
        },
        output: {
          container: outputIndex.container,
          videoCodec: video?.codecFamily,
          audioCodec: audio?.codecFamily,
          videoSamples: video === undefined ? 0 : (outputIndex.samples[video.id]?.length ?? 0),
          audioSamples: audio === undefined ? 0 : (outputIndex.samples[audio.id]?.length ?? 0),
        },
        encoderConfiguration:
          'encoderConfiguration' in measured.value ? measured.value.encoderConfiguration : null,
        mainThread: measured.window,
        memory: { before, after: memorySnapshot() },
      });
    } catch (error) {
      sink.cleanup();
      cases.push({
        ...definition,
        status: 'failed',
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: 'UnknownError', message: String(error) },
      });
    } finally {
      await session.dispose();
      media.clear();
      sink.cleanup();
    }
  }
  return {
    definition:
      'Public Session export of a real H.264/AAC MP4 fixture scaled to the stated output resolution; timing includes lazy input decode, Render IR composition, PCM decode/mix, WebCodecs encode, MP4 mux and sink close.',
    sourceFixture: 'fixtures/media/mp4-moov-head-h264-aac.mp4',
    cases,
  };
}

async function sinkBenchmark(): Promise<Record<string, unknown>> {
  const totalBytes = 16 * 1_024 * 1_024;
  const chunkBytes = 1 * 1_024 * 1_024;
  const payload = new Uint8Array(chunkBytes);
  payload.fill(0x5a);
  const run = async (
    kind: 'memory' | 'opfs',
    sink: SeekableMemorySink | OpfsSeekableSink,
  ): Promise<Record<string, unknown>> => {
    const before = memorySnapshot();
    const writer = sink.writable.getWriter();
    const started = performance.now();
    for (let position = 0; position < totalBytes; position += chunkBytes) {
      await writer.write({ type: 'write', position, data: payload });
    }
    await writer.close();
    const elapsedMs = performance.now() - started;
    const finalBytes =
      kind === 'memory'
        ? (sink as SeekableMemorySink).finalize().byteLength
        : (await (sink as OpfsSeekableSink).getFile()).size;
    const snapshot = sink.snapshot();
    if (kind === 'memory') (sink as SeekableMemorySink).cleanup();
    else await (sink as OpfsSeekableSink).cleanup();
    return {
      kind,
      totalBytes,
      chunkBytes,
      elapsedMs,
      throughputMiBPerSecond: totalBytes / 1_048_576 / (elapsedMs / 1_000),
      finalBytes,
      snapshot,
      memory: { before, after: memorySnapshot() },
    };
  };
  return {
    definition: 'Sixteen sequential 1 MiB writes; close and size verification are timed.',
    cases: [
      await run('memory', new SeekableMemorySink()),
      await run('opfs', new OpfsSeekableSink('aelion-performance-sink.bin')),
    ],
  };
}

async function compositorSoakBenchmark(graph: MaterialGraph): Promise<Record<string, unknown>> {
  const parameters = { intensity: 0.65 };
  const program = compileMaterialGraphToWebGl2(graph, {
    parameters: { intensity: 'float' },
    inputPorts: { source: 'visual-frame' },
  });
  const compositor = new WorkerCompositor();
  const iterations = 180;
  const wallMs: number[] = [];
  const heapSamples: { readonly frame: number; readonly usedJsHeapBytes: number | null }[] = [];
  try {
    for (let index = 0; index < 5; index += 1) {
      const result = await compositor.compose({
        inputs: { source: solidFrame(1_920, 1_080, 32) },
        program,
        parameters,
        preferredBackend: 'webgl2',
        width: 1_920,
        height: 1_080,
      });
      result.bitmap.close();
    }
    const before = memorySnapshot();
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      const result = await compositor.compose({
        inputs: { source: solidFrame(1_920, 1_080, index % 255) },
        program,
        parameters,
        preferredBackend: 'webgl2',
        width: 1_920,
        height: 1_080,
      });
      wallMs.push(performance.now() - started);
      result.bitmap.close();
      if ((index + 1) % 30 === 0) {
        heapSamples.push({
          frame: index + 1,
          usedJsHeapBytes: memorySnapshot().usedJsHeapBytes ?? null,
        });
      }
    }
    const resourcesBeforeDispose = compositor.snapshot();
    compositor.dispose();
    return {
      resolution: { width: 1_920, height: 1_080 },
      backend: 'webgl2',
      warmupFrames: 5,
      frames: iterations,
      overall: timingSummary(wallMs),
      firstHalfP95Ms: percentile(wallMs.slice(0, iterations / 2), 0.95),
      secondHalfP95Ms: percentile(wallMs.slice(iterations / 2), 0.95),
      heapSamples,
      memory: { before, after: memorySnapshot() },
      resourcesBeforeDispose,
      resourcesAfterDispose: compositor.snapshot(),
    };
  } finally {
    compositor.dispose();
  }
}

async function run(): Promise<Record<string, unknown>> {
  const [softGlow, warmFilm, project] = await Promise.all([
    json<MaterialGraph>('/examples/materials/soft-glow/graphs/soft-glow.graph.json'),
    json<MaterialGraph>('/examples/materials/warm-film/graphs/warm-film.graph.json'),
    json<AelionProject>('/examples/aelion-vertical-slice-30s.project.json'),
  ]);
  const runtime = await codecSupport();
  const warmFilm720pWebGl2 = await materialBenchmark(
    'Warm Film 720p single-pass WebGL2',
    warmFilm,
    { intensity: 0.65 },
    30,
    'webgl2',
    { width: 1_280, height: 720 },
  );
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
  const fourKWebGl2 = await materialBenchmark(
    'Warm Film 4K WebGL2',
    warmFilm,
    { intensity: 0.65 },
    3,
    'webgl2',
    { width: 3_840, height: 2_160 },
  );
  const compilation = compilationBenchmark();
  const profilePreflight = await profilePreflightBenchmark();
  const audio = await audioBenchmark(project);
  const exportResult = await exportBenchmark();
  const exportMatrix = await exportMatrixBenchmark();
  const realMediaPipeline = await realMediaPipelineBenchmark();
  const storage = await sinkBenchmark();
  const longTimeline = await longTimelineSimulation(project);
  const compositorSoak = await compositorSoakBenchmark(warmFilm);
  return {
    evidenceVersion: '1.0.0',
    benchmarkSuiteVersion: '2.0.0',
    fixture: 'Aelion 1080p30 SDR reference',
    methodology: {
      environment: 'fresh cross-origin-isolated headless Chrome page',
      clock: 'performance.now() wall time',
      percentiles: 'nearest-rank over disclosed raw samples',
      warmup:
        'compositor cases exclude three warmup frames; other sections disclose cold/warm boundaries separately',
      correctness:
        'frame/audio counts, muxed container signatures, sink final sizes and resource snapshots are checked',
      limitations: [
        'synthetic export matrix excludes input-media decode; realMediaPipeline covers it separately',
        'headless results are not physical mobile or Safari certification',
        'WebCodecs throughput depends on browser, driver and hardware encoder policy',
        'JavaScript heap excludes most decoder surfaces, GPU textures and browser-process memory',
        'cases execute serially in the recorded order, so thermal and cache effects remain possible',
      ],
    },
    runtime,
    material: {
      warmFilm720pWebGl2,
      warmFilmWebGpu,
      warmFilmWebGl2,
      softGlow: softGlowResult,
      fourKWebGl2,
      resourceOwnership: {
        policy: 'each benchmark compositor is disposed and reports zero pending requests',
      },
    },
    compilation,
    profilePreflight,
    audio,
    export: exportResult,
    exportMatrix,
    realMediaPipeline,
    storage,
    longTimeline,
    compositorSoak,
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
