import { describe, expect, it } from 'vitest';

import {
  av1CodecString,
  avcCodecCandidates,
  BrowserStorageExportCheckpointStore,
  hevcCodecString,
  MemoryExportCheckpointStore,
  preferredAvcCodecString,
  runCheckpointedExport,
  runRemoteExport,
  selectExportProfile,
  type RemoteExportEvent,
  type RemoteExportSession,
} from '../src/index.js';

describe('production export protocols', () => {
  it('selects the smallest bounded AVC level for HD and 4K workloads', () => {
    expect(preferredAvcCodecString(1_920, 1_080, 30)).toBe('avc1.640028');
    expect(preferredAvcCodecString(3_840, 2_160, 30)).toBe('avc1.640033');
    expect(avcCodecCandidates(3_840, 2_160, 30).slice(0, 3)).toEqual([
      'avc1.640033',
      'avc1.4d0033',
      'avc1.420033',
    ]);
    expect(() => avcCodecCandidates(0, 1_080, 30)).toThrow(RangeError);
  });

  it('selects bounded AV1 and HEVC codec strings for HD and 4K workloads', () => {
    expect(av1CodecString(1_920, 1_080, 30)).toBe('av01.0.08M.08');
    expect(av1CodecString(3_840, 2_160, 30)).toBe('av01.0.12M.08');
    expect(hevcCodecString(1_920, 1_080, 30)).toBe('hvc1.1.6.L120.B0');
    expect(hevcCodecString(3_840, 2_160, 30)).toBe('hvc1.1.6.L153.B0');
  });

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

  it('resumes committed units from a durable browser checkpoint after recreation', async () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage;
    const first = new BrowserStorageExportCheckpointStore({
      storage,
      namespace: 'test',
    });
    await expect(
      runCheckpointedExport({
        key: 'durable-job',
        contentId: 'content',
        profileId: 'still-png',
        totalUnits: 3,
        store: first,
        processUnit: index =>
          index === 1 ? Promise.reject(new Error('reload')) : Promise.resolve({ outputBytes: 8 }),
      }),
    ).rejects.toThrow('reload');
    const resumedUnits: number[] = [];
    const second = new BrowserStorageExportCheckpointStore({
      storage,
      namespace: 'test',
    });
    const completed = await runCheckpointedExport({
      key: 'durable-job',
      contentId: 'content',
      profileId: 'still-png',
      totalUnits: 3,
      store: second,
      processUnit: index => {
        resumedUnits.push(index);
        return Promise.resolve({ outputBytes: 8 });
      },
    });
    expect(resumedUnits).toEqual([1, 2]);
    expect(completed).toMatchObject({ completedUnits: 3, outputBytes: 24 });
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
          sha256: 'a'.repeat(64),
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
        provider: {
          id: 'provider',
          negotiate: () =>
            Promise.resolve({
              protocolVersion: '1.0.0',
              acceptedProfileIds: ['mp4-h264-aac'],
              maxAssetBytes: 1_024,
            }),
          start: () => Promise.resolve(session),
        },
        authorizer: {
          authorize: () => Promise.resolve({ scheme: 'Bearer', token: 'secret' }),
        },
        request: {
          protocolVersion: '1.0.0',
          contentId: 'content',
          idempotencyKey: 'content:mp4',
          profileId: 'mp4-h264-aac',
          projectId: 'project',
          sequenceId: 'sequence',
          revision: '7',
          manifest: {},
          assets: [],
          assetAuthorizations: [],
        },
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'REMOTE_EXPORT_FAILED' })],
    });
    expect({ cancelled, cleaned }).toEqual({ cancelled: 1, cleaned: 1 });
  });

  it('negotiates compatibility before issuing per-asset credentials or starting upload', async () => {
    let authorizedAssets = 0;
    let starts = 0;
    await expect(
      runRemoteExport({
        provider: {
          id: 'provider',
          negotiate: () =>
            Promise.resolve({
              protocolVersion: '1.0.0',
              acceptedProfileIds: [],
              maxAssetBytes: 1,
            }),
          start: () => {
            starts += 1;
            throw new Error('not reached');
          },
        },
        authorizer: {
          authorize: () => Promise.resolve({ scheme: 'Bearer', token: 'service-token' }),
        },
        assetAuthorizer: {
          authorizeAsset: asset => {
            authorizedAssets += 1;
            return Promise.resolve({
              assetId: asset.assetId,
              scheme: 'Bearer',
              token: 'asset-token',
            });
          },
        },
        request: {
          protocolVersion: '1.0.0',
          contentId: 'content',
          idempotencyKey: 'content:mp4',
          profileId: 'mp4-h264-aac',
          projectId: 'project',
          sequenceId: 'sequence',
          revision: '7',
          manifest: {},
          assets: [
            {
              assetId: 'source',
              contentId: 'source-v1',
              byteLength: 10,
              sha256: 'b'.repeat(64),
            },
          ],
          assetAuthorizations: [],
        },
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'REMOTE_EXPORT_INCOMPATIBLE' })],
    });
    expect({ authorizedAssets, starts }).toEqual({ authorizedAssets: 0, starts: 0 });
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
