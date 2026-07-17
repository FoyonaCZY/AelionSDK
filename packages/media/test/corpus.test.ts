import { readFile } from 'node:fs/promises';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createSampleIndex,
  createSampleIndexFromReader,
  MemoryRangeReader,
  probeSampleIndex,
  resolveVideoSeek,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);
const fixtures = [
  ['mp4-moov-head-h264-aac.mp4', 'mp4', 'avc', 'aac'],
  ['mp4-fragmented-h264-aac.mp4', 'mp4', 'avc', 'aac'],
  ['mp4-moov-tail-h264-aac.mp4', 'mp4', 'avc', 'aac'],
  ['mp4-nonzero-pts-h264-aac.mp4', 'mp4', 'avc', 'aac'],
  ['webm-vp9-opus-vfr.webm', 'webm', 'vp9', 'opus'],
] as const;

describe('media corpus normalization', () => {
  it.each(fixtures)(
    'normalizes %s into a shared SampleIndex',
    async (file, container, videoCodec, audioCodec) => {
      const bytes = new Uint8Array(await readFile(new URL(`fixtures/media/${file}`, root)));
      const index = await createSampleIndex(bytes);
      const video = index.tracks.find(track => track.kind === 'video');
      const audio = index.tracks.find(track => track.kind === 'audio');

      expect(index.container).toBe(container);
      expect(index.durationUs).toBeGreaterThanOrEqual(3_000_000);
      expect(video?.codecFamily).toBe(videoCodec);
      expect(audio?.codecFamily).toBe(audioCodec);
      expect(video === undefined ? [] : index.samples[video.id]?.length).not.toBe(0);
      expect(audio === undefined ? [] : index.samples[audio.id]?.length).not.toBe(0);
      if (video !== undefined) {
        expect(index.samples[video.id]?.some(sample => sample.isSync)).toBe(true);
        expect(index.presentationOrder[video.id]).toHaveLength(
          index.samples[video.id]?.length ?? 0,
        );
      }
      expect(index.capabilities).toEqual({
        timingAndSize: true,
        rawDecodeTimestamps: false,
        byteOffsets: false,
      });
      expect(index.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'MEDIA_SAMPLE_OFFSET_UNAVAILABLE' }),
        ]),
      );
    },
  );

  it('preserves B-frame decode order separately from presentation order', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('fixtures/media/mp4-moov-head-h264-aac.mp4', root)),
    );
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    if (video === undefined) throw new Error('Fixture has no video track');
    const samples = index.samples[video.id] ?? [];

    expect(samples.some((sample, decodeOrder) => sample.presentationOrder !== decodeOrder)).toBe(
      true,
    );
    expect(index.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MEDIA_RAW_DTS_UNAVAILABLE' })]),
    );

    const seek = resolveVideoSeek(index, video.id, 1_550_000);
    expect(seek.decodeStartSample).toBeLessThanOrEqual(seek.presentationSample);
    expect(samples[seek.decodeStartSample]?.isSync).toBe(true);
    expect(seek.presentationUs).toBeLessThanOrEqual(1_550_000);
  });

  it('preserves a non-zero presentation origin', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('fixtures/media/mp4-nonzero-pts-h264-aac.mp4', root)),
    );
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    if (video === undefined) throw new Error('Fixture has no video track');
    const first = index.samples[video.id]?.find(sample => sample.presentationOrder === 0);

    expect(first?.presentationTimestampUs).toBe(500_000);
    expect(resolveVideoSeek(index, video.id, 1_050_000).presentationUs).toBeGreaterThanOrEqual(
      500_000,
    );
  });

  it('demuxes through the RangeReader contract without requiring a whole-file API', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('fixtures/media/webm-vp9-opus-vfr.webm', root)),
    );
    const index = await createSampleIndexFromReader(new MemoryRangeReader('webm', bytes));
    expect(index.container).toBe('webm');
    expect(index.tracks.some(track => track.kind === 'video')).toBe(true);
    expect(index.tracks.some(track => track.kind === 'audio')).toBe(true);
  });

  it('returns a stable diagnostic for truncated/corrupt media', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('fixtures/media/mp4-moov-head-h264-aac.mp4', root)),
    );
    const corrupt = bytes.slice(0, 97);
    corrupt.fill(0);
    const result = await probeSampleIndex(corrupt);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'MEDIA_INPUT_INVALID' })],
    });
  });

  it('fails closed for bounded arbitrary media bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 4_096 }), async bytes => {
        const result = await probeSampleIndex(bytes);
        if (result.ok) {
          expect(result.index.tracks.length).toBeGreaterThan(0);
        } else {
          expect(result.diagnostics).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'MEDIA_INPUT_INVALID' })]),
          );
        }
      }),
      { numRuns: 250, endOnFailure: true },
    );
  });
});
