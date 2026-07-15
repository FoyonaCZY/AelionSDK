import { renderIrAudio } from '@aelion/audio';
import type { JsonObject } from '@aelion/core';
import { exportFrozenRenderIrWebM, OpfsSeekableSink } from '@aelion/export';
import {
  compileMaterialGraphToWebGl2,
  type MaterialGraph,
  type WebGl2MaterialProgram,
} from '@aelion/material-compiler';
import { createSampleIndex, decodeAudioPcmRange, decodeVideoFrameAt } from '@aelion/media';
import { ProjectValidator } from '@aelion/project-schema';
import { IncrementalRenderCompiler, type IrMaterialDefinition } from '@aelion/render-ir';
import { RenderIrFrameRenderer, type IrFrameSource } from '@aelion/renderer-worker';
import { TransactionEngine } from '@aelion/transaction';

interface VerticalSliceEvidence {
  readonly bytes: Uint8Array;
  readonly report: Record<string, unknown>;
}

async function json(path: string): Promise<JsonObject> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`);
  return response.json() as Promise<JsonObject>;
}

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function closeBitmaps(bitmaps: Iterable<ImageBitmap>): void {
  for (const bitmap of bitmaps) bitmap.close();
}

async function run(): Promise<VerticalSliceEvidence> {
  const startedAt = performance.now();
  const [
    projectValue,
    projectSchema,
    materialSchema,
    warmGraph,
    transitionGraph,
    openingBytes,
    closingBytes,
  ] = await Promise.all([
    json('/examples/aelion-vertical-slice-30s.project.json'),
    json('/schemas/project/v1/project.schema.json'),
    json('/schemas/material/v1/instance.schema.json'),
    json('/examples/materials/warm-film/graphs/warm-film.graph.json'),
    json('/examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
    bytes('/fixtures/media/mp4-moov-head-h264-aac.mp4'),
    bytes('/fixtures/media/webm-vp9-opus-vfr.webm'),
  ]);
  const validator = new ProjectValidator({
    projectSchema,
    materialInstanceSchema: materialSchema,
  });
  const validation = validator.validate(projectValue);
  if (!validation.ok) throw new Error(JSON.stringify(validation.diagnostics));
  const engine = new TransactionEngine(validation.value.project, value => {
    const result = validator.validate(value);
    return { ok: result.ok, diagnostics: result.diagnostics };
  });
  const compiler = new IncrementalRenderCompiler();
  const programs = new Map<string, WebGl2MaterialProgram>([
    [
      'warm-film',
      compileMaterialGraphToWebGl2(warmGraph as unknown as MaterialGraph, {
        parameters: { intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      }),
    ],
    [
      'cross-dissolve',
      compileMaterialGraphToWebGl2(transitionGraph as unknown as MaterialGraph, {
        parameters: { curve: 'enum' },
        specializationValues: { curve: 'smooth' },
        inputPorts: { from: 'visual-frame', to: 'visual-frame' },
        systems: { transitionProgress: 'float' },
      }),
    ],
  ]);
  const resolveMaterialProgram = (
    definition: IrMaterialDefinition,
  ): WebGl2MaterialProgram | undefined => programs.get(definition.materialId);
  const initial = compiler.compile(engine.getSnapshot(), 'seq_vertical', engine.revision, {
    resolveMaterialProgram,
  });
  const commit = engine.edit({ baseRevision: 0n, label: 'Vertical slice evidence edit' }, edit => {
    edit.setField('items', 'item_opening', ['visual', 'opacity'], 0.8);
    edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.85);
  });
  const compilation = compiler.compile(commit.snapshot, 'seq_vertical', commit.revision, {
    affectedEntityIds: commit.changeSet.affectedEntityIds,
    affectedRanges: commit.changeSet.affectedRanges,
    resolveMaterialProgram,
  });
  const ir = compilation.ir;
  const visualBytes = new Map<string, Uint8Array>([
    ['asset_opening', openingBytes],
    ['asset_closing', closingBytes],
  ]);
  const bitmapCache = new Map<string, ImageBitmap>();
  const frameSource: IrFrameSource = {
    frameAt: async (assetId, _streamIndex, sourceTimeUs, signal) => {
      const key = `${assetId}:${sourceTimeUs.toString()}`;
      let bitmap = bitmapCache.get(key);
      if (bitmap === undefined) {
        const sourceBytes = visualBytes.get(assetId);
        if (sourceBytes === undefined) throw new Error(`Unknown visual asset ${assetId}`);
        const decoded = await decodeVideoFrameAt(sourceBytes, sourceTimeUs, {
          maxDecodeQueueSize: 8,
          ...(signal === undefined ? {} : { signal }),
        });
        try {
          bitmap = await createImageBitmap(decoded.frame);
          bitmapCache.set(key, bitmap);
        } finally {
          decoded.close();
        }
      }
      return new VideoFrame(bitmap, { timestamp: sourceTimeUs });
    },
  };
  const music = await decodeAudioPcmRange(closingBytes, 0, 3_000_000);
  const pcmSource = {
    pcmRange: (assetId: string, _streamIndex: number, startUs: number, durationUs: number) => {
      if (assetId !== 'asset_music') throw new Error(`Unknown audio asset ${assetId}`);
      const frameCount = Math.ceil((durationUs * music.sampleRate) / 1_000_000);
      const startFrame = Math.floor((startUs * music.sampleRate) / 1_000_000);
      const interleaved = new Float32Array(frameCount * music.channelCount);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sourceFrame = (startFrame + frame) % music.frameCount;
        for (let channel = 0; channel < music.channelCount; channel += 1) {
          interleaved[frame * music.channelCount + channel] =
            music.interleaved[sourceFrame * music.channelCount + channel] ?? 0;
        }
      }
      return Promise.resolve({
        sampleRate: music.sampleRate,
        channelCount: music.channelCount,
        frameCount,
        interleaved,
      });
    },
  };
  const renderer = new RenderIrFrameRenderer();
  const sink = new OpfsSeekableSink(`aelion-vertical-${crypto.randomUUID()}.webm`);
  const progress: number[] = [];
  try {
    const result = await exportFrozenRenderIrWebM({
      ir,
      projectRevision: commit.revision,
      videoBitrate: 800_000,
      audioBitrate: 96_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: async request => {
        const rendered = await renderer.render({
          ir,
          timeUs: request.timestampUs,
          source: frameSource,
          mode: 'export',
          preferredBackend: 'webgl2',
        });
        try {
          return new VideoFrame(rendered.bitmap, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          });
        } finally {
          rendered.bitmap.close();
        }
      },
      renderAudio: request =>
        renderIrAudio({
          ir,
          startFrame: request.startFrame,
          frameCount: request.frameCount,
          channelCount: request.channelCount,
          source: pcmSource,
        }),
      onProgress: value => {
        if (progress.length === 0 || value - (progress.at(-1) ?? 0) >= 0.1 || value === 1) {
          progress.push(value);
        }
      },
    });
    const file = await sink.getFile();
    const outputBytes = new Uint8Array(await file.arrayBuffer());
    music.interleaved.fill(0);
    const index = await createSampleIndex(outputBytes);
    const video = index.tracks.find(track => track.kind === 'video');
    const audio = index.tracks.find(track => track.kind === 'audio');
    if (video === undefined || audio === undefined) throw new Error('Exported tracks are missing');
    const videoSamples = index.samples[video.id] ?? [];
    const audioSamples = index.samples[audio.id] ?? [];
    const videoEndUs = Math.max(
      0,
      ...videoSamples.map(sample => sample.presentationTimestampUs + sample.durationUs),
    );
    const audioEndUs = Math.max(
      0,
      ...audioSamples.map(sample => sample.presentationTimestampUs + sample.durationUs),
    );
    await renderer.dispose();
    closeBitmaps(bitmapCache.values());
    bitmapCache.clear();
    const opfsRoot = await navigator.storage.getDirectory();
    let opfsOutputRemoved = true;
    try {
      await opfsRoot.removeEntry(sink.snapshot().fileName);
    } catch {
      opfsOutputRemoved = false;
    }
    return {
      bytes: outputBytes,
      report: {
        projectId: ir.projectId,
        revision: ir.revision.toString(),
        durationUs: ir.durationUs,
        transaction: {
          affectedEntityIds: commit.changeSet.affectedEntityIds,
          affectedRanges: commit.changeSet.affectedRanges,
        },
        compilation: {
          initial: initial.stats,
          incremental: compilation.stats,
        },
        export: result,
        sink: sink.snapshot(),
        readback: {
          container: index.container,
          durationUs: index.durationUs,
          videoCodec: video.codecFamily,
          audioCodec: audio.codecFamily,
          videoSamples: videoSamples.length,
          audioSamples: audioSamples.length,
          videoEndUs,
          audioEndUs,
          avEndDriftUs: videoEndUs - audioEndUs,
        },
        resources: {
          cachedDecodedBitmaps: bitmapCache.size,
          cachedPcmFrames: music.frameCount,
          retainedPcmFrames: 0,
          compositorDisposed: renderer.disposed,
          opfsOutputRemoved,
        },
        progress,
        elapsedMs: performance.now() - startedAt,
        userAgent: navigator.userAgent,
      },
    };
  } finally {
    await renderer.dispose();
    closeBitmaps(bitmapCache.values());
    bitmapCache.clear();
    await navigator.storage
      .getDirectory()
      .then(root => root.removeEntry(sink.snapshot().fileName).catch(() => undefined));
  }
}

void run()
  .then(evidence => {
    Reflect.set(globalThis, '__AELION_VERTICAL_EVIDENCE__', evidence);
    const status = document.querySelector('#status');
    if (status !== null) status.textContent = 'AelionSDK evidence complete';
  })
  .catch((error: unknown) => {
    Reflect.set(
      globalThis,
      '__AELION_VERTICAL_ERROR__',
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    );
    const status = document.querySelector('#status');
    if (status !== null) status.textContent = 'AelionSDK evidence failed';
  });
