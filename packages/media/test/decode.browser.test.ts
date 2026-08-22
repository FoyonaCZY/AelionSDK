import { describe, expect, it } from 'vitest';

import {
  BlobRangeReader,
  createVideoFrameDecodeSessionFromReader,
  createSampleIndex,
  decodeAudioPcmRange,
  decodeAudioPcmRangeFromReader,
  decodeVideoFrameAt,
  decodeVideoFrameAtFromReader,
  resolveVideoSeek,
  videoDecoderResourceSnapshot,
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
    const rangeResult = await decodeVideoFrameAtFromReader(
      new BlobRangeReader(`${file}:range`, new Blob([bytes])),
      targetUs,
      { maxDecodeQueueSize: 8 },
    );

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
      expect(rangeResult.timestampUs).toBe(result.timestampUs);
      expect(rangeResult.frame.displayWidth).toBe(result.frame.displayWidth);
    } finally {
      result.close();
      rangeResult.close();
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

  it('reuses one bounded decoder session for sequential frames and restarts after eviction', async () => {
    const bytes = await fixture('mp4-moov-head-h264-aac.mp4');
    const reader = new BlobRangeReader('persistent-session', new Blob([bytes]));
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    if (video === undefined) throw new Error('Fixture has no video');
    const samples = index.samples[video.id];
    const order = index.presentationOrder[video.id];
    if (samples === undefined || order === undefined)
      throw new Error('Fixture has no sample index');
    const timestamps = order
      .slice(0, 8)
      .map(sampleIndex => samples[sampleIndex]?.presentationTimestampUs)
      .filter((value): value is number => value !== undefined);
    const baseline = videoDecoderResourceSnapshot();
    const session = createVideoFrameDecodeSessionFromReader(reader, index, {
      maxCachedFrames: 3,
      maxCachedBytes: 4 * 1_024 * 1_024,
      maxSequentialGapUs: 1_000_000,
    });

    try {
      for (const timestampUs of timestamps) {
        const decoded = await session.frameAt(timestampUs);
        try {
          expect(decoded.timestampUs).toBe(timestampUs);
        } finally {
          decoded.close();
        }
      }
      const warm = await session.frameAt(timestamps.at(-1) ?? 0);
      warm.close();
      const beforeBackwardSeek = session.snapshot();
      expect(beforeBackwardSeek).toMatchObject({
        cacheHits: 1,
        seeks: 1,
        cachedFrames: 3,
        active: true,
      });
      expect(beforeBackwardSeek.sequentialFrames).toBeGreaterThan(0);
      expect(beforeBackwardSeek.cachedBytes).toBeLessThanOrEqual(4 * 1_024 * 1_024);

      const backward = await session.frameAt(timestamps[0] ?? 0);
      backward.close();
      expect(session.snapshot().seeks).toBe(2);
    } finally {
      session.dispose();
    }

    expect(session.snapshot()).toMatchObject({
      cachedFrames: 0,
      cachedBytes: 0,
      active: false,
      disposed: true,
    });
    expect(videoDecoderResourceSnapshot()).toEqual(baseline);
  });

  it('rejects a queued frameAt as soon as its signal aborts', async () => {
    const bytes = await fixture('mp4-moov-head-h264-aac.mp4');
    const reader = new BlobRangeReader('queued-abort-session', new Blob([bytes]));
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    const samples = video === undefined ? undefined : index.samples[video.id];
    const order = video === undefined ? undefined : index.presentationOrder[video.id];
    const firstUs =
      order === undefined ? undefined : samples?.[order[0] ?? -1]?.presentationTimestampUs;
    const secondUs =
      order === undefined ? undefined : samples?.[order[1] ?? -1]?.presentationTimestampUs;
    if (firstUs === undefined || secondUs === undefined) {
      throw new Error('Fixture has no sequential video samples');
    }
    const session = createVideoFrameDecodeSessionFromReader(reader, index);
    const controller = new AbortController();
    try {
      const first = session.frameAt(firstUs);
      const queued = session.frameAt(secondUs, controller.signal);
      controller.abort();
      await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
      (await first).close();
    } finally {
      session.dispose();
    }
  });

  it('resumes sequential decode after an in-flight frameAt is aborted', async () => {
    const bytes = await fixture('mp4-moov-head-h264-aac.mp4');
    const reader = new BlobRangeReader('inflight-abort-session', new Blob([bytes]));
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    const samples = video === undefined ? undefined : index.samples[video.id];
    const order = video === undefined ? undefined : index.presentationOrder[video.id];
    const firstUs =
      order === undefined ? undefined : samples?.[order[0] ?? -1]?.presentationTimestampUs;
    const laterUs =
      order === undefined
        ? undefined
        : samples?.[order[12] ?? order[1] ?? -1]?.presentationTimestampUs;
    if (firstUs === undefined || laterUs === undefined) {
      throw new Error('Fixture has no sequential video samples');
    }
    const session = createVideoFrameDecodeSessionFromReader(reader, index);
    try {
      const first = await session.frameAt(firstUs);
      first.close();
      const controller = new AbortController();
      const inflight = session.frameAt(laterUs, controller.signal);
      controller.abort();
      await expect(inflight).rejects.toMatchObject({ name: 'AbortError' });
      const resumed = await Promise.race([
        session.frameAt(firstUs).then(result => {
          result.close();
          return 'ok' as const;
        }),
        new Promise<'latched'>(resolve => {
          globalThis.setTimeout(() => resolve('latched'), 1_000);
        }),
      ]);
      expect(resumed).toBe('ok');
    } finally {
      session.dispose();
    }
  });

  it.each(['mp4-moov-head-h264-aac.mp4', 'webm-vp9-opus-vfr.webm'])(
    'normalizes decoded audio from %s to interleaved f32 PCM',
    async file => {
      const bytes = await fixture(file);
      const [block, rangeBlock] = await Promise.all([
        decodeAudioPcmRange(bytes, 500_000, 100_000),
        decodeAudioPcmRangeFromReader(
          new BlobRangeReader(`${file}:audio-range`, new Blob([bytes])),
          500_000,
          100_000,
        ),
      ]);
      expect(block.sampleRate).toBe(48_000);
      expect(block.channelCount).toBe(1);
      expect(block.frameCount).toBe(4_800);
      expect(block.interleaved).toHaveLength(4_800);
      expect(block.interleaved.some(value => Math.abs(value) > 0.001)).toBe(true);
      expect(rangeBlock).toMatchObject({
        sampleRate: block.sampleRate,
        channelCount: block.channelCount,
        frameCount: block.frameCount,
      });
      expect(rangeBlock.interleaved).toEqual(block.interleaved);
    },
  );
});
