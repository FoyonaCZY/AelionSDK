import { SeekableMemorySink } from '@aelion/export';
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
  type AelionSessionApi,
  type PreviewCanvasController,
} from '@aelion/sdk';

export interface EditorRuntime {
  readonly session: AelionSessionApi;
  readonly media: ProductionMediaProvider;
  readonly preview: PreviewCanvasController;
  dispose(): Promise<void>;
}

/** Complete File -> validated Project -> live Canvas integration. */
export async function createEditorRuntime(
  file: File,
  canvas: HTMLCanvasElement,
): Promise<EditorRuntime> {
  const media = new ProductionMediaProvider();
  media.registerFile('asset_main', file);

  const probe = await media.probe('asset_main');
  const video = probe.index.tracks.find(track => track.kind === 'video');
  const project = createProject({
    projectId: 'my_project',
    sequenceId: 'main_sequence',
    title: file.name,
    width: video?.codedWidth ?? 1920,
    height: video?.codedHeight ?? 1080,
  });
  await project.importMedia({
    provider: media,
    assetId: 'asset_main',
    name: file.name,
    ...(file.type.length === 0 ? {} : { mimeType: file.type }),
  });

  const session = await Aelion.createSession({ media });
  await session.loadProject(project.build());
  const preview = attachPreviewCanvas(session, canvas, { quality: 'adaptive' });
  await preview.render(0);

  return {
    session,
    media,
    preview,
    dispose: async () => {
      preview.dispose();
      await session.dispose();
      media.dispose();
    },
  };
}

/** Export the current frozen Project revision with browser H.264/AAC encoders. */
export async function exportH264(session: AelionSessionApi): Promise<Uint8Array> {
  const sink = new SeekableMemorySink();
  const options = {
    profile: 'mp4-h264-aac',
    sink: sink.writable,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
  } as const;
  const report = await session.export.preflightProfile(options);
  if (!report.ok) {
    throw new Error(`MP4 export is unavailable: ${report.issues.map(issue => issue.code).join(', ')}`);
  }
  await session.export.startProfile(options);
  return sink.finalize();
}
