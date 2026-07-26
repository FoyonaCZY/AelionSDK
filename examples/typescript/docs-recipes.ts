import {
  OpfsSeekableSink,
  SeekableMemorySink,
  type RemoteExportAuthorizer,
  type RemoteExportProvider,
} from '@aelion/export';
import {
  AelionExtensionHost,
  IndexedDbProjectRevisionStore,
  ProjectPersistenceController,
  attachPreviewCanvas,
  createComposition,
  migrateDiffusionCheckpoint,
  migrateWebAvProject,
  seconds,
  type AelionSessionApi,
  type DiffusionMigrationOptions,
  type PreviewCanvasController,
  type WebAvProjectSnapshot,
} from '@aelion/sdk';

/** Product-level Composition/Layer/Clip authoring used by the Composition guide. */
export function buildCompositionRecipe() {
  const composition = createComposition({
    projectId: 'docs_composition',
    sequenceId: 'main',
    width: 1280,
    height: 720,
    durationUs: seconds(5),
  });
  const visual = composition.layer('visual', { name: 'Main' });
  const captions = composition.layer('caption', { name: 'Captions' });
  const material = composition.material({
    packageId: 'dev.aelion.examples.transitions',
    packageVersion: '0.1.0',
    packageIntegrity: `sha256:${'0'.repeat(64)}`,
    materialId: 'cross-dissolve',
  });
  const from = visual
    .shape({
      kind: 'rectangle',
      durationUs: seconds(3),
      box: { x: 0, y: 0, width: 640, height: 720 },
      fill: '#14213d',
    })
    .effect(material)
    .keyframes('opacity', [
      { timeUs: 0, value: 0 },
      { timeUs: seconds(1), value: 1 },
    ]);
  const to = visual.shape({
    kind: 'ellipse',
    atUs: seconds(2),
    durationUs: seconds(3),
    box: { x: 640, y: 0, width: 640, height: 720 },
    fill: '#fca311',
  });
  visual
    .text({ text: 'Aelion', durationUs: seconds(5) })
    .mask(from, { featherPx: 4 });
  captions.caption({
    text: 'One portable Project',
    durationUs: seconds(2),
  });
  composition.transition(from, to, material, {
    atUs: seconds(2),
    durationUs: seconds(1),
  });
  return composition.build();
}

/** Interactive Canvas mapping and capture-stream surface used by the Preview guide. */
export function connectInteractivePreview(
  session: AelionSessionApi,
  canvas: HTMLCanvasElement,
  onPoint: (x: number, y: number) => void,
): PreviewCanvasController {
  return attachPreviewCanvas(session, canvas, {
    quality: 'adaptive',
    fit: 'contain',
    onPointer: event => {
      if (event.point.inside) onPoint(event.point.x, event.point.y);
    },
  });
}

export function capturePreview(
  preview: PreviewCanvasController,
  frameRate = 30,
): MediaStream {
  return preview.captureStream(frameRate);
}

/** Session audio analysis and revision-bound mastering settings. */
export async function prepareDialogueAudio(session: AelionSessionApi): Promise<number> {
  const report = await session.audio.analyze({ trackIds: ['dialogue'] });
  session.audio.configureMastering({
    targetLufs: -16,
    limiter: { ceilingDbtp: -1 },
  });
  return report.integratedLufs;
}

/** IndexedDB autosave controller with ordered revision writes. */
export function attachProjectPersistence(
  session: AelionSessionApi,
): Promise<ProjectPersistenceController> {
  const store = new IndexedDbProjectRevisionStore({
    databaseName: 'aelion-docs-recipes',
  });
  return ProjectPersistenceController.attach(session, store, {
    debounceMs: 500,
  });
}

/** Bounded Worker RPC host used by the extension-isolation guide. */
export async function connectExtension(worker: Worker): Promise<AelionExtensionHost> {
  const host = new AelionExtensionHost(worker, {
    maxPendingCalls: 4,
    maxPayloadBytes: 256 * 1024,
  });
  await host.ready;
  return host;
}

/** Strict source-project migration recipes. */
export function migrateWebAvRecipe(snapshot: WebAvProjectSnapshot) {
  return migrateWebAvProject(snapshot, { strict: true });
}

export function migrateDiffusionRecipe(
  checkpoint: unknown,
  options: DiffusionMigrationOptions,
) {
  return migrateDiffusionCheckpoint(checkpoint, { ...options, strict: true });
}

/** Representative transaction snippets used by the documentation. */
export function editTimeline(session: AelionSessionApi, itemId: string, trackId: string): void {
  session.transaction.commands.moveItem({ itemId, toTrackId: trackId, startUs: 1_000_000 });
  session.transaction.commands.splitItem({
    itemId,
    rightItemId: `${itemId}_right`,
    atUs: 1_500_000,
  });
}

/** H.264 preflight, frozen export job and discriminated result access. */
export async function exportMp4(session: AelionSessionApi): Promise<Uint8Array> {
  const sink = new SeekableMemorySink();
  const options = {
    profile: 'mp4-h264-aac' as const,
    sink: sink.writable,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
  };
  const report = await session.export.preflightProfile(options);
  if (!report.ok) throw new Error(report.issues.map(issue => issue.code).join(', '));
  const result = await session.export.startProfile(options);
  if (!('encoderConfiguration' in result)) throw new Error('Unexpected export result');
  return sink.finalize();
}

/** OPFS-backed WAV export for outputs that should not stay in JavaScript memory. */
export async function exportWav(session: AelionSessionApi): Promise<File> {
  const sink = new OpfsSeekableSink('mix.wav');
  const result = await session.export.startProfile({
    profile: 'audio-wav',
    sampleFormat: 'f32',
    sink: sink.writable,
    cleanupSink: () => sink.cleanup(),
  });
  if (!('rf64' in result)) throw new Error('Unexpected export result');
  await sink.waitUntilFinalized();
  return sink.getFile();
}

/** Type contract expected from a host remote rendering service. */
export function createRemoteAdapters(api: {
  token(signal?: AbortSignal): Promise<{ value: string; expiresAtMs: number }>;
  start: RemoteExportProvider['start'];
}): { authorizer: RemoteExportAuthorizer; provider: RemoteExportProvider } {
  return {
    authorizer: {
      async authorize(signal) {
        const token = await api.token(signal);
        return { scheme: 'Bearer', token: token.value, expiresAtMs: token.expiresAtMs };
      },
    },
    provider: { id: 'example-render-service', start: api.start },
  };
}
