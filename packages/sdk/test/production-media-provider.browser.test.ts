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
});
