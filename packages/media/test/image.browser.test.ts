import { describe, expect, it } from 'vitest';

import { decodeStillImage } from '../src/index.js';

async function fixture(path: string): Promise<Uint8Array> {
  const response = await fetch(`/fixtures/media/${path}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

describe('still image decode', () => {
  it('decodes an AVIF still through createImageBitmap', async () => {
    const bytes = await fixture('avif-still.avif');
    const blob = new Blob([bytes], { type: 'image/avif' });
    const decoded = await decodeStillImage(blob);
    try {
      expect(decoded.width).toBe(64);
      expect(decoded.height).toBe(36);
      expect(decoded.frame.displayWidth).toBe(64);
      expect(decoded.frame.displayHeight).toBe(36);
      expect(decoded.frame.format).not.toBe('');
    } finally {
      decoded.close();
    }
  });
});
