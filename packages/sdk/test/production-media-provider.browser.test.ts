import { describe, expect, it } from 'vitest';

import { ProductionMediaProvider } from '../src/production-media-provider.js';

describe('ProductionMediaProvider browser image path', () => {
  it('decodes and reuses a bounded first-class still image', async () => {
    const canvas = new OffscreenCanvas(4, 3);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D context unavailable');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const provider = new ProductionMediaProvider({
      maxCachedImages: 1,
      maxCachedImageBytes: 1_024,
      maxImageDecodeBytes: 4_096,
    });
    provider.registerImageBlob('poster', blob);

    try {
      const first = await provider.frameAt('poster', 0, 0);
      const second = await provider.frameAt('poster', 0, 2_000_000);
      try {
        expect(first.displayWidth).toBe(4);
        expect(first.displayHeight).toBe(3);
        expect(second.displayWidth).toBe(4);
        expect(provider.snapshot()).toMatchObject({
          cachedImages: 1,
          imageCacheHits: 1,
          imageCacheMisses: 1,
          decodeSessions: 0,
        });
        expect(provider.snapshot().cachedImageBytes).toBeLessThanOrEqual(1_024);
      } finally {
        first.close();
        second.close();
      }
      provider.clear();
      expect(provider.snapshot()).toMatchObject({ cachedImages: 0, cachedImageBytes: 0 });
    } finally {
      provider.dispose();
    }
  });

  it('imports, seeks and decodes bounded windows from a 30-minute source', async () => {
    const response = await fetch('/fixtures/media/mp4-sparse-30m-h264-aac.mp4');
    expect(response.ok).toBe(true);
    const provider = new ProductionMediaProvider({
      maxDecodeSessions: 1,
      maxCachedVideoFramesPerSession: 2,
      maxCachedVideoBytesPerSession: 64 * 36 * 4 * 2,
      maxSequentialDecodeGapUs: 2_000_000,
    });
    provider.registerBlob('long-source', await response.blob());

    try {
      const probe = await provider.probe('long-source');
      const video = probe.index.tracks.find(track => track.kind === 'video');
      const audio = probe.index.tracks.find(track => track.kind === 'audio');
      if (video === undefined || audio === undefined) throw new Error('Long fixture is incomplete');
      expect(probe.index.durationUs).toBeGreaterThanOrEqual(1_800_000_000);

      const opening = await provider.frameAt('long-source', 0, 0);
      const ending = await provider.frameAt('long-source', 0, 1_799_000_000);
      const tail = await provider.pcmRange('long-source', 0, 1_799_000_000, 250_000);
      try {
        expect(opening.displayWidth).toBe(64);
        expect(ending.timestamp).toBeGreaterThanOrEqual(1_799_000_000);
        expect(tail.frameCount).toBeGreaterThan(0);
        expect(provider.snapshot()).toMatchObject({
          activeOperations: 0,
          pendingOperations: 0,
          decodeSessions: 1,
          activeDecodeSessions: 0,
        });
        expect(provider.snapshot().cachedVideoFrames).toBeLessThanOrEqual(2);
        expect(provider.snapshot().cachedVideoBytes).toBeLessThanOrEqual(64 * 36 * 4 * 2);
      } finally {
        opening.close();
        ending.close();
      }

      provider.clear();
      expect(provider.snapshot()).toMatchObject({
        cachedIndexes: 0,
        cachedVideoFrames: 0,
        decodeSessions: 0,
      });
    } finally {
      provider.dispose();
    }
  }, 60_000);
});
