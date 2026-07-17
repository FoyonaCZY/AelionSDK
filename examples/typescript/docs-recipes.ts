import {
  OpfsSeekableSink,
  SeekableMemorySink,
  type RemoteExportAuthorizer,
  type RemoteExportProvider,
} from '@aelion/export';
import type { AelionSessionApi } from '@aelion/sdk';

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
