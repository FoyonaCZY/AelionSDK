import { describe, expect, it } from 'vitest';

import { ProductionMediaProvider } from '../src/production-media-provider.js';

async function fixture(path: string): Promise<Blob> {
  const response = await fetch(`/fixtures/media/${path}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status.toString()}`);
  return await response.blob();
}

describe('preview frames honour maxDimension', () => {
  it('shrinks an oversized preview source and leaves export at full resolution', async () => {
    const provider = new ProductionMediaProvider();
    provider.registerBlob('clip', await fixture('mp4-moov-head-h264-aac.mp4'));
    try {
      const probe = await provider.probe('clip');
      const video = probe.index.tracks.find(track => track.kind === 'video');
      if (video === undefined) throw new Error('Fixture has no video track');
      const sourceMax = Math.max(video.codedWidth, video.codedHeight);
      // Ask for half the source's longest edge, the shape of a Project whose
      // frame is smaller than its footage.
      const target = Math.floor(sourceMax / 2);

      const preview = await provider.frameAt('clip', 0, 0, undefined, {
        purpose: 'preview',
        maxDimension: target,
      });
      const exported = await provider.frameAt('clip', 0, 0, undefined, {
        purpose: 'export',
        maxDimension: target,
      });
      const untouched = await provider.frameAt('clip', 0, 0, undefined, {
        purpose: 'preview',
        maxDimension: sourceMax * 2,
      });
      try {
        expect(Math.max(preview.displayWidth, preview.displayHeight)).toBe(target);
        // Aspect ratio survives the reduction.
        expect(preview.displayWidth / preview.displayHeight).toBeCloseTo(
          video.codedWidth / video.codedHeight,
          1,
        );
        // Export must keep every source pixel.
        expect(Math.max(exported.displayWidth, exported.displayHeight)).toBe(sourceMax);
        // A source already within budget is passed through, not re-encoded.
        expect(Math.max(untouched.displayWidth, untouched.displayHeight)).toBe(sourceMax);
      } finally {
        preview.close();
        exported.close();
        untouched.close();
      }
    } finally {
      provider.dispose();
    }
  }, 120_000);
});
