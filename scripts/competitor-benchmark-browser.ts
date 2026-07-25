import type * as AelionSdk from '../packages/sdk/src/index.js';

interface WebAvTickResult {
  readonly video?: VideoFrame;
}

interface WebAvClip {
  readonly ready: Promise<unknown>;
  tick(timeUs: number): Promise<WebAvTickResult>;
  destroy(): void;
}

interface WebAvSprite {
  opacity: number;
  time: { offset: number; duration: number; playbackRate?: number };
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly ready: Promise<void>;
  offscreenRender(context: OffscreenCanvasRenderingContext2D, timeUs: number): Promise<unknown>;
  destroy(): void;
}

export interface WebAvBenchmarkModule {
  readonly MP4Clip: new (
    source: ReadableStream<Uint8Array>,
    options?: { readonly audio?: boolean },
  ) => WebAvClip;
  readonly ImgClip: new (source: ImageBitmap) => WebAvClip;
  readonly OffscreenSprite: new (clip: WebAvClip) => WebAvSprite;
}

interface DiffusionClip {
  opacity: number;
}

interface DiffusionLayer {
  add<T extends DiffusionClip>(clip: T): Promise<T>;
}

interface DiffusionComposition {
  add(layer: DiffusionLayer, index?: number): Promise<DiffusionLayer>;
  mount(element: HTMLElement): void;
  unmount(): void;
  seek(timeSeconds: number): Promise<void>;
  screenshot(format?: 'webp' | 'png' | 'jpeg', quality?: number): string;
  clear(): void;
}

export interface DiffusionBenchmarkModule {
  readonly Source: {
    from<T>(input: Blob): Promise<T>;
  };
  readonly Composition: new (options: {
    width: number;
    height: number;
    background?: string;
  }) => DiffusionComposition;
  readonly Layer: new (options?: { mode?: 'SEQUENTIAL' | 'STACKED' }) => DiffusionLayer;
  readonly VideoClip: new (
    source: unknown,
    options: {
      range: readonly [number, number];
      transition?: { type: string; duration: number };
    },
  ) => DiffusionClip;
  readonly TextClip: new (options: {
    text: string;
    duration: number;
    position: 'center';
    font: { family: string; size: number; weight: string };
    color: string;
  }) => DiffusionClip;
}

export interface CompetitorBenchmarkLibraries {
  readonly aelion: typeof AelionSdk;
  readonly webav: WebAvBenchmarkModule;
  readonly diffusion: DiffusionBenchmarkModule;
}

interface TimingSummary {
  readonly samplesMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
}

interface EngineBenchmarkResult {
  readonly engine: 'aelion' | 'webav' | 'diffusion-studio-core';
  readonly setupMs: number;
  readonly sequential: TimingSummary;
  readonly warmSeek: TimingSummary;
  readonly diagnostics?: readonly string[];
  readonly resourceSnapshot?: unknown;
}

export interface SameMachineBenchmarkReport {
  readonly schemaVersion: 'aelion.competitor-benchmark/1';
  readonly capturedAt: string;
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number;
    readonly deviceMemoryGiB?: number;
    readonly crossOriginIsolated: boolean;
    readonly webGpu: boolean;
  };
  readonly workload: {
    readonly output: '1920x1080@30';
    readonly source: 'dual 320x180 H.264/AVC B-frame streams scaled to 1080p';
    readonly overlay: 'rich text';
    readonly transition: '500ms dissolve/crossfade';
    readonly sequentialSamples: number;
    readonly warmSeekSamples: number;
  };
  readonly results: readonly EngineBenchmarkResult[];
}

const sequentialTimesSeconds = Array.from({ length: 30 }, (_, index) => 1.25 + (index % 15) / 30);
const warmSeekTimesSeconds = [
  2.7, 0.1, 1.5, 0.7, 2.2, 1.3, 0.2, 2.8, 1.45, 0.95, 2.4, 0.35, 1.6, 0.55, 2.65, 1.1, 0.05, 2.95,
  1.4, 0.8,
];

function timingSummary(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number): number => {
    const index = Math.max(0, Math.ceil(sorted.length * value) - 1);
    return sorted[index] ?? 0;
  };
  return {
    samplesMs: samples.map(value => Math.round(value * 1_000) / 1_000),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maximumMs: sorted.at(-1) ?? 0,
  };
}

async function measure(
  times: readonly number[],
  render: (timeSeconds: number) => Promise<void>,
): Promise<TimingSummary> {
  const samples: number[] = [];
  for (const time of times) {
    const started = performance.now();
    await render(time);
    samples.push(performance.now() - started);
  }
  return timingSummary(samples);
}

async function mediaBlob(): Promise<Blob> {
  const response = await fetch('/fixtures/media/mp4-moov-head-h264-aac.mp4');
  if (!response.ok) throw new Error(`Fixture request failed with ${response.status.toString()}`);
  return new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
}

async function benchmarkAelion(sdk: typeof AelionSdk, blob: Blob): Promise<EngineBenchmarkResult> {
  const started = performance.now();
  const provider = new sdk.ProductionMediaProvider({
    maxDecodeSessions: 4,
    maxCachedVideoFramesPerSession: 16,
    maxCachedVideoBytesPerSession: 1920 * 1080 * 4 * 16,
  });
  provider.registerBlob('source_a', blob, {
    durationUs: 3_000_000,
    width: 320,
    height: 180,
  });
  provider.registerBlob('source_b', blob, {
    durationUs: 3_000_000,
    width: 320,
    height: 180,
  });
  const materials = new sdk.RuntimeMaterialRegistry();
  const disposeMaterials = sdk.installMigrationMaterials(materials);
  const builder = sdk.createProject({
    projectId: 'same_machine_benchmark',
    sequenceId: 'main',
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    durationUs: 3_000_000,
  });
  builder.addAsset({ id: 'source_a', kind: 'video' });
  builder.addAsset({ id: 'source_b', kind: 'video' });
  const videoTrack = builder.addTrack({ id: 'video', kind: 'visual' });
  const textTrack = builder.addTrack({ id: 'text', kind: 'visual' });
  const first = builder.addMediaClip({
    id: 'first',
    kind: 'video',
    assetId: 'source_a',
    trackId: videoTrack,
    atUs: 0,
    durationUs: 1_500_000,
    sourceDurationUs: 1_500_000,
    fit: 'fill',
  });
  const second = builder.addMediaClip({
    id: 'second',
    kind: 'video',
    assetId: 'source_b',
    trackId: videoTrack,
    atUs: 1_500_000,
    durationUs: 1_500_000,
    sourceStartUs: 1_500_000,
    sourceDurationUs: 1_500_000,
    fit: 'fill',
  });
  builder.addTextClip({
    id: 'title',
    trackId: textTrack,
    text: 'Aelion · WebAV · Diffusion',
    atUs: 0,
    durationUs: 3_000_000,
    box: { x: 360, y: 440, width: 1200, height: 200 },
    style: {
      fontFamilies: ['sans-serif'],
      fontSizePx: 72,
      fontWeight: 700,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidthPx: 3,
      align: 'center',
    },
  });
  const transitionMaterial = builder.addMaterialInstance({
    id: 'dissolve',
    ...sdk.migrationMaterialPackage,
    materialId: 'diffusion-dissolve',
  });
  builder.addTransition({
    id: 'crossfade',
    fromItemId: first,
    toItemId: second,
    materialInstanceId: transitionMaterial,
    atUs: 1_250_000,
    durationUs: 500_000,
  });
  const session = new sdk.AelionSession({
    media: provider,
    materials,
    preferredBackend: 'auto',
  });
  await session.loadProject(builder.build());
  const render = async (timeSeconds: number): Promise<void> => {
    const frame = await session.preview.renderFrame({
      timeUs: Math.round(timeSeconds * 1_000_000),
    });
    frame.bitmap.close();
  };
  await render(0);
  await render(1.5);
  const setupMs = performance.now() - started;
  const sequential = await measure(sequentialTimesSeconds, render);
  const warmSeek = await measure(warmSeekTimesSeconds, render);
  const snapshot = provider.snapshot();
  const diagnostics = session.getDiagnostics().map(value => `${value.code}:${value.severity}`);
  await session.dispose();
  provider.dispose();
  disposeMaterials();
  return {
    engine: 'aelion',
    setupMs,
    sequential,
    warmSeek,
    diagnostics,
    resourceSnapshot: snapshot,
  };
}

async function benchmarkWebAv(
  webav: WebAvBenchmarkModule,
  blob: Blob,
): Promise<EngineBenchmarkResult> {
  const started = performance.now();
  const canvas = new OffscreenCanvas(1920, 1080);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('WebAV benchmark requires OffscreenCanvas 2D');
  const firstClip = new webav.MP4Clip(blob.stream(), { audio: false });
  const secondClip = new webav.MP4Clip(blob.stream(), { audio: false });
  const first = new webav.OffscreenSprite(firstClip);
  const second = new webav.OffscreenSprite(secondClip);
  first.time = { offset: 0, duration: 3_000_000 };
  second.time = { offset: 0, duration: 3_000_000 };
  for (const sprite of [first, second]) {
    sprite.rect.x = 0;
    sprite.rect.y = 0;
    sprite.rect.w = 1920;
    sprite.rect.h = 1080;
  }
  const textCanvas = new OffscreenCanvas(1200, 180);
  const textContext = textCanvas.getContext('2d');
  if (textContext === null) throw new Error('WebAV text canvas unavailable');
  textContext.font = '700 72px sans-serif';
  textContext.textAlign = 'center';
  textContext.textBaseline = 'middle';
  textContext.lineWidth = 6;
  textContext.strokeStyle = '#000000';
  textContext.fillStyle = '#ffffff';
  textContext.strokeText('Aelion · WebAV · Diffusion', 600, 90);
  textContext.fillText('Aelion · WebAV · Diffusion', 600, 90);
  const textClip = new webav.ImgClip(textCanvas.transferToImageBitmap());
  const text = new webav.OffscreenSprite(textClip);
  text.time = { offset: 0, duration: 3_000_000 };
  text.rect.x = 360;
  text.rect.y = 440;
  await Promise.all([first.ready, second.ready, text.ready]);
  const render = async (timeSeconds: number): Promise<void> => {
    const timeUs = Math.round(timeSeconds * 1_000_000);
    const progress = Math.max(0, Math.min(1, (timeUs - 1_250_000) / 500_000));
    first.opacity = 1 - progress;
    second.opacity = progress;
    context.clearRect(0, 0, canvas.width, canvas.height);
    await first.offscreenRender(context, timeUs);
    await second.offscreenRender(context, timeUs);
    await text.offscreenRender(context, timeUs);
  };
  await render(0);
  await render(1.5);
  const setupMs = performance.now() - started;
  const sequential = await measure(sequentialTimesSeconds, render);
  const warmSeek = await measure(warmSeekTimesSeconds, render);
  const verification = await canvas.convertToBlob({ type: 'image/png' });
  if (verification.size === 0) throw new Error('WebAV produced an empty verification frame');
  first.destroy();
  second.destroy();
  text.destroy();
  return {
    engine: 'webav',
    setupMs,
    sequential,
    warmSeek,
    resourceSnapshot: { verificationPngBytes: verification.size },
  };
}

async function benchmarkDiffusion(
  diffusion: DiffusionBenchmarkModule,
  blob: Blob,
): Promise<EngineBenchmarkResult> {
  const started = performance.now();
  const [firstSource, secondSource] = await Promise.all([
    diffusion.Source.from<unknown>(blob),
    diffusion.Source.from<unknown>(blob),
  ]);
  const composition = new diffusion.Composition({
    width: 1920,
    height: 1080,
    background: '#000000',
  });
  const mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1920px;height:1080px';
  document.body.append(mount);
  composition.mount(mount);
  const video = await composition.add(new diffusion.Layer({ mode: 'SEQUENTIAL' }));
  await video.add(
    new diffusion.VideoClip(firstSource, {
      range: [0, 1.5],
      transition: { type: 'dissolve', duration: 0.5 },
    }),
  );
  await video.add(
    new diffusion.VideoClip(secondSource, {
      range: [1.5, 3],
    }),
  );
  const text = await composition.add(new diffusion.Layer({ mode: 'STACKED' }), 0);
  await text.add(
    new diffusion.TextClip({
      text: 'Aelion · WebAV · Diffusion',
      duration: 3,
      position: 'center',
      font: { family: 'sans-serif', size: 72, weight: '700' },
      color: '#ffffff',
    }),
  );
  const render = (timeSeconds: number): Promise<void> => composition.seek(timeSeconds);
  await render(0);
  await render(1.5);
  const setupMs = performance.now() - started;
  const sequential = await measure(sequentialTimesSeconds, render);
  const warmSeek = await measure(warmSeekTimesSeconds, render);
  const verification = composition.screenshot('png');
  if (!verification.startsWith('data:image/png')) {
    throw new Error('Diffusion Studio Core produced an invalid verification frame');
  }
  composition.unmount();
  composition.clear();
  mount.remove();
  return {
    engine: 'diffusion-studio-core',
    setupMs,
    sequential,
    warmSeek,
    resourceSnapshot: { verificationDataUrlLength: verification.length },
  };
}

export async function runSameMachineCompetitorBenchmark(
  libraries: CompetitorBenchmarkLibraries,
): Promise<SameMachineBenchmarkReport> {
  const blob = await mediaBlob();
  const results: EngineBenchmarkResult[] = [];
  for (const benchmark of [
    () => benchmarkAelion(libraries.aelion, blob),
    () => benchmarkWebAv(libraries.webav, blob),
    () => benchmarkDiffusion(libraries.diffusion, blob),
  ]) {
    results.push(await benchmark());
  }
  const navigatorWithMemory = navigator as Navigator & { readonly deviceMemory?: number };
  return {
    schemaVersion: 'aelion.competitor-benchmark/1',
    capturedAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      ...(navigatorWithMemory.deviceMemory === undefined
        ? {}
        : { deviceMemoryGiB: navigatorWithMemory.deviceMemory }),
      crossOriginIsolated,
      webGpu: 'gpu' in navigator,
    },
    workload: {
      output: '1920x1080@30',
      source: 'dual 320x180 H.264/AVC B-frame streams scaled to 1080p',
      overlay: 'rich text',
      transition: '500ms dissolve/crossfade',
      sequentialSamples: sequentialTimesSeconds.length,
      warmSeekSamples: warmSeekTimesSeconds.length,
    },
    results,
  };
}
