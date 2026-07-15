import { OpfsSeekableSink } from '@aelion/export';
import {
  compileMaterialGraphToWebGl2,
  type MaterialGraph,
  type WebGl2MaterialProgram,
} from '@aelion/material-compiler';
import { createSampleIndex } from '@aelion/media';
import type { IrMaterialDefinition } from '@aelion/render-ir';
import { Aelion, ByteMediaProvider, RuntimeMaterialRegistry } from '@aelion/sdk';

interface AlphaEvidence {
  readonly bytes: Uint8Array;
  readonly report: Record<string, unknown>;
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status.toString()}`);
  return response.json() as Promise<T>;
}

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status.toString()}`);
  return new Uint8Array(await response.arrayBuffer());
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

async function run(): Promise<AlphaEvidence> {
  const startedAt = performance.now();
  const longTasks: number[] = [];
  const observer =
    typeof PerformanceObserver === 'function'
      ? new PerformanceObserver(list => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : undefined;
  try {
    observer?.observe({ type: 'longtask', buffered: true });
  } catch {
    observer?.disconnect();
  }

  const [project, warmGraph, dissolveGraph, mp4, webm] = await Promise.all([
    json<Record<string, unknown>>('/examples/aelion-alpha-60s.project.json'),
    json<MaterialGraph>('/examples/materials/warm-film/graphs/warm-film.graph.json'),
    json<MaterialGraph>('/examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
    bytes('/fixtures/media/mp4-moov-head-h264-aac.mp4'),
    bytes('/fixtures/media/webm-vp9-opus-vfr.webm'),
  ]);

  const assetBytes = new Map<string, Uint8Array>([
    ['asset_opening', mp4],
    ['asset_closing', webm],
    ['asset_music', webm],
  ]);
  const media = new ByteMediaProvider({
    maxCachedBytes: 16 * 1_024 * 1_024,
    resolveAssetBytes: assetId => {
      const value = assetBytes.get(assetId);
      if (value === undefined) throw new Error(`Unknown fixture asset ${assetId}`);
      return Promise.resolve(value);
    },
  });
  const programs = new Map<string, WebGl2MaterialProgram>([
    [
      'warm-film',
      compileMaterialGraphToWebGl2(warmGraph, {
        parameters: { intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      }),
    ],
    [
      'cross-dissolve',
      compileMaterialGraphToWebGl2(dissolveGraph, {
        parameters: { curve: 'enum' },
        specializationValues: { curve: 'smooth' },
        inputPorts: { from: 'visual-frame', to: 'visual-frame' },
        systems: { transitionProgress: 'float' },
      }),
    ],
  ]);
  const definitions = Object.values(
    (project.materialInstances ?? {}) as Record<
      string,
      { readonly definition: IrMaterialDefinition }
    >,
  ).map(value => value.definition);
  const materials = new RuntimeMaterialRegistry();
  for (const definition of definitions) {
    const program = programs.get(definition.materialId);
    if (program === undefined) throw new Error(`Missing program ${definition.materialId}`);
    materials.register(definition, program);
  }

  const session = await Aelion.createSession({
    media,
    materials,
    preferredBackend: 'webgl2',
  });
  const sessionEvents: string[] = [];
  const unsubscribeSession = session.subscribe(event => sessionEvents.push(event.type));
  const playerFrames: number[] = [];
  const unsubscribePlayer = session.player.subscribe(frame => {
    playerFrames.push(frame.timestampUs);
    frame.result.bitmap.close();
  });
  const sink = new OpfsSeekableSink(`aelion-alpha-${crypto.randomUUID()}.webm`);
  const progress: number[] = [];
  const memoryBefore = memorySnapshot();
  try {
    await session.loadProject(project);
    const initialRevision = session.revision;
    const edit = session.transaction.edit(
      transaction => {
        transaction.setField('items', 'item_opening', ['visual', 'opacity'], 0.8);
        transaction.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.85);
      },
      { label: 'Phase 1 Alpha evidence edit', baseRevision: 0n },
    );
    const undo = session.transaction.undo();
    const redo = session.transaction.redo();

    await session.player.seek(29_500_000);
    await session.player.play();
    await new Promise(resolve => globalThis.setTimeout(resolve, 250));
    await session.player.pause();
    const preview = await session.preview.renderFrame({ timeUs: 30_000_000 });
    const previewSummary = {
      width: preview.bitmap.width,
      height: preview.bitmap.height,
      backend: preview.backend,
      materialIds: preview.materialIds,
    };
    preview.bitmap.close();

    const preflight = await session.export.preflight({ sink: sink.writable });
    if (!preflight.ok) throw new Error(JSON.stringify(preflight.issues));
    const exported = await session.export.start({
      sink: sink.writable,
      videoBitrate: 800_000,
      audioBitrate: 96_000,
      cleanupSink: () => sink.cleanup(),
      onProgress: value => {
        if (progress.length === 0 || value - (progress.at(-1) ?? 0) >= 0.1 || value === 1) {
          progress.push(value);
        }
      },
    });
    const outputBytes = new Uint8Array(await (await sink.getFile()).arrayBuffer());
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
    const beforeDispose = session.getSnapshot();
    const historyBeforeDispose = {
      canUndo: session.transaction.canUndo,
      canRedo: session.transaction.canRedo,
    };
    const playerBeforeDispose = {
      state: session.player.state,
      currentTimeUs: session.player.currentTimeUs,
      emittedFrames: playerFrames.length,
      firstTimestampUs: playerFrames.at(0) ?? null,
      lastTimestampUs: playerFrames.at(-1) ?? null,
    };
    const mediaBeforeDispose = media.snapshot();
    const sinkBeforeCleanup = sink.snapshot();
    observer?.disconnect();
    unsubscribePlayer();
    unsubscribeSession();
    await session.dispose();
    const afterDisposeStats = session.getStats();
    media.clear();
    const mediaAfterDispose = media.snapshot();
    await sink.cleanup();
    let opfsOutputRemoved = false;
    try {
      await (await navigator.storage.getDirectory()).getFileHandle(sink.snapshot().fileName);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') opfsOutputRemoved = true;
      else throw error;
    }
    return {
      bytes: outputBytes,
      report: {
        evidenceVersion: '1.0.0',
        projectId: project.projectId,
        fixture: 'examples/aelion-alpha-60s.project.json',
        durationUs: beforeDispose.renderIr?.durationUs,
        revisions: {
          initial: initialRevision?.toString(),
          edited: edit.revision.toString(),
          undo: undo.revision.toString(),
          redo: redo.revision.toString(),
        },
        history: historyBeforeDispose,
        player: playerBeforeDispose,
        preview: previewSummary,
        export: exported,
        sink: sinkBeforeCleanup,
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
        progress,
        publicApi: { sessionEvents, usedFacadeOnly: true },
        queues: { sinkMaxInFlightWrites: sinkBeforeCleanup.maxInFlightWrites },
        resources: {
          mediaBeforeDispose,
          sessionStateBeforeDispose: beforeDispose.state,
          sessionStateAfterDispose: session.state,
          sessionRuntimeBeforeDispose: {
            renderer: beforeDispose.stats.preview,
            player: beforeDispose.stats.player.resources,
            activeExportJobId: beforeDispose.stats.export.activeJobId,
          },
          sessionRuntimeAfterDispose: {
            renderer: afterDisposeStats.preview,
            player: afterDisposeStats.player.resources,
            activeExportJobId: afterDisposeStats.export.activeJobId,
          },
          mediaAfterDispose,
          providerDrained:
            mediaAfterDispose.assets === 0 &&
            mediaAfterDispose.cachedBytes === 0 &&
            mediaAfterDispose.inFlightRequests === 0 &&
            mediaAfterDispose.inFlightAssetLoads === 0 &&
            mediaAfterDispose.inFlightSampleIndexes === 0 &&
            mediaAfterDispose.sharedOperationSubscribers === 0 &&
            mediaAfterDispose.activeOperations === 0 &&
            mediaAfterDispose.pendingOperations === 0,
          opfsOutputRemoved,
        },
        mainThread: {
          longTasksOver50Ms: longTasks.filter(value => value > 50).length,
          maxLongTaskMs: Math.max(0, ...longTasks),
        },
        memory: { before: memoryBefore, beforeDispose: memorySnapshot() },
        elapsedMs: performance.now() - startedAt,
        userAgent: navigator.userAgent,
      },
    };
  } finally {
    observer?.disconnect();
    unsubscribePlayer();
    unsubscribeSession();
    await session.dispose();
    media.clear();
    await sink.cleanup();
  }
}

void run()
  .then(evidence => {
    Reflect.set(globalThis, '__AELION_ALPHA_EVIDENCE__', evidence);
    const status = document.querySelector('#status');
    if (status !== null) status.textContent = 'AelionSDK Phase 1 Alpha evidence complete';
  })
  .catch((error: unknown) => {
    Reflect.set(
      globalThis,
      '__AELION_ALPHA_ERROR__',
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    );
    const status = document.querySelector('#status');
    if (status !== null) status.textContent = 'AelionSDK Phase 1 Alpha evidence failed';
  });
