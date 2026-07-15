import { describe, expect, it } from 'vitest';

import {
  createSampleIndex,
  decodeAudioPcmRange,
  decodeVideoFrameAt,
  resolveVideoSeek,
} from '../src/index.js';

async function fixture(path: string): Promise<Uint8Array> {
  const response = await fetch(`/fixtures/media/${path}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

describe('WebCodecs exact seek', () => {
  it.each([
    'mp4-moov-head-h264-aac.mp4',
    'mp4-fragmented-h264-aac.mp4',
    'mp4-moov-tail-h264-aac.mp4',
    'mp4-nonzero-pts-h264-aac.mp4',
    'webm-vp9-opus-vfr.webm',
  ])('decodes the oracle presentation frame from %s', async file => {
    const bytes = await fixture(file);
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    if (video === undefined) throw new Error('Fixture has no video');
    const targetUs = 1_550_000;
    const oracle = resolveVideoSeek(index, video.id, targetUs);
    const result = await decodeVideoFrameAt(bytes, targetUs, { maxDecodeQueueSize: 8 });

    try {
      expect(result.timestampUs).toBe(oracle.presentationUs);
      expect(result.timestampUs).toBeLessThanOrEqual(targetUs);
      expect(result.frame.displayWidth).toBe(320);
      expect(result.frame.displayHeight).toBe(180);
      expect(result.frame.codedWidth).toBeGreaterThanOrEqual(result.frame.displayWidth);
      expect(result.frame.codedHeight).toBeGreaterThanOrEqual(result.frame.displayHeight);
      expect(result.decodedPackets).toBeGreaterThan(0);
      expect(result.decodedPackets).toBeLessThanOrEqual(31);
      expect(result.decodedPackets).toBe(result.plannedPackets);
    } finally {
      result.close();
    }
  });

  it('honors cancellation before allocating a decoder', async () => {
    const bytes = await fixture('mp4-moov-head-h264-aac.mp4');
    const controller = new AbortController();
    controller.abort('test');
    await expect(
      decodeVideoFrameAt(bytes, 1_000_000, { signal: controller.signal }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
  });

  it('rejects a missing video stream instead of silently decoding the first track', async () => {
    const bytes = await fixture('mp4-moov-head-h264-aac.mp4');
    await expect(decodeVideoFrameAt(bytes, 0, { streamIndex: 1 })).rejects.toThrow(
      'Requested video stream does not exist',
    );
  });

  it.each(['mp4-moov-head-h264-aac.mp4', 'webm-vp9-opus-vfr.webm'])(
    'normalizes decoded audio from %s to interleaved f32 PCM',
    async file => {
      const bytes = await fixture(file);
      const block = await decodeAudioPcmRange(bytes, 500_000, 100_000);
      expect(block.sampleRate).toBe(48_000);
      expect(block.channelCount).toBe(1);
      expect(block.frameCount).toBe(4_800);
      expect(block.interleaved).toHaveLength(4_800);
      expect(block.interleaved.some(value => Math.abs(value) > 0.001)).toBe(true);
    },
  );
});
