import { describe, expect, it } from 'vitest';

import {
  MemoryExportCheckpointStore,
  runCheckpointedExport,
  runRemoteExport,
  selectExportProfile,
  type RemoteExportEvent,
  type RemoteExportSession,
} from '../src/index.js';

describe('production export protocols', () => {
  it('resumes after the last atomically committed export unit', async () => {
    const store = new MemoryExportCheckpointStore();
    const firstRun: number[] = [];
    await expect(
      runCheckpointedExport({
        key: 'job',
        contentId: 'content',
        profileId: 'animated-gif',
        totalUnits: 4,
        store,
        processUnit: index => {
          firstRun.push(index);
          if (index === 2) return Promise.reject(new Error('temporary'));
          return Promise.resolve({ outputBytes: 10 });
        },
      }),
    ).rejects.toThrow('temporary');
    expect(firstRun).toEqual([0, 1, 2]);

    const resumed: number[] = [];
    const checkpoint = await runCheckpointedExport({
      key: 'job',
      contentId: 'content',
      profileId: 'animated-gif',
      totalUnits: 4,
      store,
      processUnit: index => {
        resumed.push(index);
        return Promise.resolve({ outputBytes: 10 });
      },
    });
    expect(resumed).toEqual([2, 3]);
    expect(checkpoint).toMatchObject({ completedUnits: 4, outputBytes: 40 });
  });

  it('binds remote results to content identity and cleans a failed provider job', async () => {
    let cancelled = 0;
    let cleaned = 0;
    async function* events(): AsyncIterable<RemoteExportEvent> {
      await Promise.resolve();
      yield { type: 'progress', progress: 0.5 };
      yield {
        type: 'completed',
        result: {
          providerJobId: 'wrong-job',
          contentId: 'content',
          profileId: 'mp4-h264-aac',
          mimeType: 'video/mp4',
          byteLength: 10,
        },
      };
    }
    const session: RemoteExportSession = {
      providerJobId: 'job',
      events: events(),
      cancel: () => {
        cancelled += 1;
        return Promise.resolve();
      },
      cleanup: () => {
        cleaned += 1;
        return Promise.resolve();
      },
    };
    await expect(
      runRemoteExport({
        provider: { id: 'provider', start: () => Promise.resolve(session) },
        authorizer: {
          authorize: () => Promise.resolve({ scheme: 'Bearer', token: 'secret' }),
        },
        request: {
          contentId: 'content',
          idempotencyKey: 'content:mp4',
          profileId: 'mp4-h264-aac',
          projectId: 'project',
          sequenceId: 'sequence',
          revision: '7',
          manifest: {},
        },
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'REMOTE_EXPORT_FAILED' })],
    });
    expect({ cancelled, cleaned }).toEqual({ cancelled: 1, cleaned: 1 });
  });

  it('returns a remote option when the preferred local profile is unavailable', async () => {
    const selection = await selectExportProfile({
      preferred: 'mp4-h264-aac',
      remoteAvailable: true,
    });
    expect(selection.execution).toBe('remote');
    expect(selection.selected?.id).toBe('mp4-h264-aac');
    expect(selection.attempts).toHaveLength(1);
  });
});
