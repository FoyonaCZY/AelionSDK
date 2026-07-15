import { describe, expect, it } from 'vitest';

import {
  MemoryCacheStore,
  proxyPresentationTimeUs,
  SegmentedIndex,
  selectAssetRepresentation,
} from '../src/index.js';

const hash = (digit: string): string => digit.repeat(64);

describe('long-media cache and proxy contracts', () => {
  it('evicts content-addressed entries by LRU under an exact byte budget', async () => {
    const cache = new MemoryCacheStore(6);
    const first = { namespace: 'thumbnail' as const, contentHash: hash('a'), version: '1' };
    const second = { namespace: 'thumbnail' as const, contentHash: hash('b'), version: '1' };
    const third = { namespace: 'thumbnail' as const, contentHash: hash('c'), version: '1' };
    await cache.put(first, Uint8Array.of(1, 2));
    await cache.put(second, Uint8Array.of(3, 4));
    await cache.get(first);
    await cache.put(third, Uint8Array.of(5, 6, 7));
    expect(await cache.get(first)).toEqual(Uint8Array.of(1, 2));
    expect(await cache.get(second)).toBeUndefined();
    expect(cache.snapshot()).toMatchObject({ entries: 2, bytes: 5, evictions: 1 });
  });

  it('single-flights and bounds resident long-timeline index segments', async () => {
    const loads: number[] = [];
    const index = new SegmentedIndex({
      durationUs: 180_000_000,
      segmentDurationUs: 60_000_000,
      maxResidentSegments: 2,
      load: startUs => {
        loads.push(startUs);
        return Promise.resolve({ startUs });
      },
    });
    const [first, duplicate] = await Promise.all([
      index.segmentAt(1_000_000),
      index.segmentAt(2_000_000),
    ]);
    expect(first).toBe(duplicate);
    await index.segmentAt(61_000_000);
    await index.segmentAt(121_000_000);
    expect(loads).toEqual([0, 60_000_000, 120_000_000]);
    expect(index.snapshot()).toEqual({ residentSegments: 2, inFlightSegments: 0 });
  });

  it('selects only time-consistent preview proxies and preserves presentation time', () => {
    const selection = selectAssetRepresentation(
      {
        id: 'asset',
        locator: { type: 'url', uri: '/original.mp4' },
        representations: [
          {
            id: 'bad',
            role: 'proxy',
            locator: { type: 'url', uri: '/bad.mp4' },
            durationUs: 9_000_000,
            width: 640,
            height: 360,
          },
          {
            id: 'good',
            role: 'proxy',
            locator: { type: 'url', uri: '/good.mp4' },
            durationUs: 10_000_000,
            width: 960,
            height: 540,
          },
        ],
      },
      { purpose: 'preview', sourceDurationUs: 10_000_000, maxDimension: 1_000 },
    );
    expect(selection.representation.id).toBe('good');
    expect(selection.usedProxy).toBe(true);
    expect(selection.diagnostics).toContain('MEDIA_PROXY_DURATION_MISMATCH');
    expect(proxyPresentationTimeUs(1_234_567, selection.representation)).toBe(1_234_567);
  });
});
