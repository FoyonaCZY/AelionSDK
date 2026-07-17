import { readFile } from 'node:fs/promises';

import { MemoryCacheStore, type RangeReader } from '@aelion/media';
import { describe, expect, it } from 'vitest';

import { ProductionMediaProvider } from '../src/production-media-provider.js';

const root = new URL('../../../', import.meta.url);

describe('ProductionMediaProvider', () => {
  it('selects a right-sized proxy for preview and the original for export', () => {
    const provider = new ProductionMediaProvider();
    provider.registerBlob('asset', new Blob([new Uint8Array([1])]), {
      id: 'asset:original',
      width: 3840,
      height: 2160,
      durationUs: 3_000_000,
    });
    provider.registerBlob('asset', new Blob([new Uint8Array([2])]), {
      id: 'asset:proxy-720',
      role: 'proxy',
      width: 1280,
      height: 720,
      durationUs: 3_000_000,
    });

    expect(provider.representationFor('asset', { purpose: 'preview', maxDimension: 1280 })).toEqual(
      {
        assetId: 'asset',
        representationId: 'asset:proxy-720',
        role: 'proxy',
        usedProxy: true,
        diagnostics: [],
      },
    );
    expect(provider.representationFor('asset', { purpose: 'export' })).toMatchObject({
      representationId: 'asset:original',
      usedProxy: false,
    });
    provider.dispose();
  });

  it('probes Blob media with RangeReader and reuses a content-addressed index', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('fixtures/media/webm-vp9-opus-vfr.webm', root)),
    );
    const cache = new MemoryCacheStore(8 * 1_024 * 1_024);
    const contentHash = 'a'.repeat(64);
    const first = new ProductionMediaProvider({ cache });
    first.registerBlob('asset', new Blob([bytes]), { contentHash });
    const probe = await first.probe('asset');

    expect(probe.index.container).toBe('webm');
    expect(probe.index.tracks.some(track => track.kind === 'video')).toBe(true);
    expect(first.snapshot()).toMatchObject({ assets: 1, representations: 1, cachedIndexes: 1 });
    first.dispose();

    let reads = 0;
    const inaccessibleReader: RangeReader = {
      id: 'cached-original',
      kind: 'memory',
      size: () => Promise.reject(new Error('cache miss attempted to read size')),
      read: () => {
        reads += 1;
        return Promise.reject(new Error('cache miss attempted to read bytes'));
      },
    };
    const second = new ProductionMediaProvider({ cache });
    second.registerReader('asset', inaccessibleReader, { contentHash });
    const restored = await second.probe('asset');

    expect(restored.index.durationUs).toBe(probe.index.durationUs);
    expect(restored.index.tracks).toEqual(probe.index.tracks);
    expect(reads).toBe(0);
    expect(cache.snapshot().hits).toBeGreaterThan(0);
    second.dispose();
  });

  it('rejects unsafe registration data and becomes terminal after disposal', () => {
    const provider = new ProductionMediaProvider();
    expect(() => provider.registerBlob('', new Blob())).toThrow(/assetId/u);
    expect(() =>
      provider.registerBlob('asset', new Blob(), { contentHash: 'not-a-sha-256' }),
    ).toThrow(/contentHash/u);
    provider.dispose();
    expect(() => provider.registerBlob('asset', new Blob())).toThrow(/disposed/u);
  });
});
