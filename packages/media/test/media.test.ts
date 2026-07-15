import { describe, expect, it, vi } from 'vitest';

import {
  FetchRangeReader,
  MemoryRangeReader,
  resolveVideoSeek,
  type SampleIndex,
} from '../src/index.js';

describe('RangeReader', () => {
  it('returns only the requested bytes and immutable copies', async () => {
    const input = Uint8Array.from({ length: 16 }, (_, index) => index);
    const reader = new MemoryRangeReader('fixture', input);
    input.fill(255);

    const result = await reader.read({ offset: 4, length: 5 });
    expect(result.bytes).toEqual(Uint8Array.from([4, 5, 6, 7, 8]));
    expect(result.totalSize).toBe(16);
    expect(await reader.size()).toBe(16);
  });

  it('rejects an out-of-bounds read before allocating', async () => {
    const reader = new MemoryRangeReader('fixture', new Uint8Array(8));
    await expect(reader.read({ offset: 7, length: 2 })).rejects.toThrow(/exceeds source size/u);
  });

  it('honors cancellation', async () => {
    const reader = new MemoryRangeReader('fixture', new Uint8Array(8));
    const controller = new AbortController();
    controller.abort('test');
    await expect(reader.read({ offset: 0, length: 1 }, controller.signal)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
  });

  it('validates Content-Range and never accepts a silent full response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-length': '4' },
      }),
    );
    const reader = new FetchRangeReader('remote', 'https://media.invalid/clip.mp4', { fetch });
    await expect(reader.read({ offset: 0, length: 1 })).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'MEDIA_RANGE_UNSUPPORTED' })],
    });
  });

  it('surfaces CORS/network fetch failures without accepting partial data', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch (CORS)'));
    const reader = new FetchRangeReader('cors', 'https://media.invalid/cors.mp4', { fetch });
    await expect(reader.read({ offset: 0, length: 1 })).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'MEDIA_NETWORK_OR_CORS_FAILED' })],
    });
  });
});

describe('exact seek planning', () => {
  const sampleIndex: SampleIndex = {
    schemaVersion: '1.0.0',
    container: 'mp4',
    durationUs: 200_000,
    capabilities: {
      timingAndSize: true,
      rawDecodeTimestamps: false,
      byteOffsets: false,
    },
    tracks: [
      {
        kind: 'video',
        id: 1,
        codec: 'avc1.64001e',
        codecFamily: 'avc',
        codedWidth: 320,
        codedHeight: 180,
        rotation: 0,
      },
    ],
    presentationOrder: { 1: [0, 1, 2, 3] },
    samples: {
      1: [
        {
          trackId: 1,
          sampleIndex: 0,
          kind: 'video',
          decodeOrder: 0,
          presentationOrder: 0,
          sourceSequenceNumber: 0,
          presentationTimestampUs: 0,
          durationUs: 33_333,
          normalizedDecodeTimeUs: 0,
          isSync: true,
        },
        {
          trackId: 1,
          sampleIndex: 1,
          kind: 'video',
          decodeOrder: 1,
          presentationOrder: 1,
          sourceSequenceNumber: 1,
          presentationTimestampUs: 33_333,
          durationUs: 33_334,
          normalizedDecodeTimeUs: 33_333,
          isSync: false,
        },
        {
          trackId: 1,
          sampleIndex: 2,
          kind: 'video',
          decodeOrder: 2,
          presentationOrder: 2,
          sourceSequenceNumber: 2,
          presentationTimestampUs: 66_667,
          durationUs: 33_333,
          normalizedDecodeTimeUs: 66_667,
          isSync: false,
        },
        {
          trackId: 1,
          sampleIndex: 3,
          kind: 'video',
          decodeOrder: 3,
          presentationOrder: 3,
          sourceSequenceNumber: 3,
          presentationTimestampUs: 100_000,
          durationUs: 33_333,
          normalizedDecodeTimeUs: 100_000,
          isSync: true,
        },
      ],
    },
    diagnostics: [],
  };

  it('selects the presentation sample at or before target and decodes from sync', () => {
    expect(resolveVideoSeek(sampleIndex, 1, 90_000)).toEqual({
      trackId: 1,
      targetUs: 90_000,
      decodeStartSample: 0,
      presentationSample: 2,
      decodeStartUs: 0,
      presentationUs: 66_667,
      samplesToDecode: 3,
    });
  });

  it('uses a later sync sample when the target is beyond it', () => {
    expect(resolveVideoSeek(sampleIndex, 1, 120_000)).toMatchObject({
      decodeStartSample: 3,
      presentationSample: 3,
      samplesToDecode: 1,
    });
  });
});
