import { createSampleIndex, decodeAudioPcmRange, decodeVideoFrameAt } from '@aelion/media';
import { describe, expect, it } from 'vitest';

import {
  exportResumableMuxed,
  IndexedDbResumableMuxedExportStore,
  MemoryResumableMuxedExportStore,
  SeekableMemorySink,
} from '../src/index.js';

function renderFrame(request: {
  readonly frameIndex: number;
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly width: number;
  readonly height: number;
}): Promise<VideoFrame> {
  const canvas = new OffscreenCanvas(request.width, request.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.fillStyle = `rgb(${request.frameIndex * 7} ${request.frameIndex * 3} 127)`;
  context.fillRect(0, 0, request.width, request.height);
  context.fillStyle = 'white';
  context.fillRect(request.frameIndex % request.width, 4, 8, 8);
  return Promise.resolve(
    new VideoFrame(canvas, {
      timestamp: request.timestampUs,
      duration: request.durationUs,
    }),
  );
}

function renderAudio(request: {
  readonly startFrame: number;
  readonly frameCount: number;
  readonly sampleRate: number;
  readonly channelCount: number;
}): Promise<Float32Array> {
  return Promise.resolve(
    Float32Array.from({ length: request.frameCount * request.channelCount }, (_, index) => {
      const frame = request.startFrame + Math.floor(index / request.channelCount);
      return Math.sin((frame * 2 * Math.PI * 440) / request.sampleRate) * 0.05;
    }),
  );
}

async function semanticSignature(bytes: Uint8Array): Promise<unknown> {
  const index = await createSampleIndex(bytes);
  const video = index.tracks.find(track => track.kind === 'video');
  const audio = index.tracks.find(track => track.kind === 'audio');
  if (video === undefined || audio === undefined) throw new Error('Muxed tracks are missing');
  const decodedVideo = await Promise.all(
    [0, 1_000_000, 1_900_000].map(async timeUs => {
      const decoded = await decodeVideoFrameAt(bytes, timeUs);
      try {
        const rgba = new Uint8Array(decoded.frame.codedWidth * decoded.frame.codedHeight * 4);
        await decoded.frame.copyTo(rgba, { format: 'RGBA' });
        return [...rgba];
      } finally {
        decoded.close();
      }
    }),
  );
  const pcm = await decodeAudioPcmRange(bytes, 0, 2_000_000);
  return {
    container: index.container,
    videoSamples: index.samples[video.id]?.map(sample => [
      sample.presentationTimestampUs,
      sample.durationUs,
      sample.isSync,
    ]),
    audioFrames: pcm.frameCount,
    audioChannels: pcm.channelCount,
    video: decodedVideo,
    pcm: [...pcm.interleaved],
  };
}

describe('resumable muxed export', () => {
  it('atomically reloads binary units from a recreated IndexedDB store', async () => {
    const databaseName = `aelion-resume-${crypto.randomUUID()}`;
    const first = new IndexedDbResumableMuxedExportStore({ databaseName });
    await first.commitUnit(
      'job',
      { index: 0, init: new Uint8Array([1, 2]), media: new Uint8Array([3, 4, 5]) },
      {
        version: 1,
        contentId: 'content',
        configurationId: 'config',
        profile: 'webm-vp9-opus',
        durationUs: 1,
        totalUnits: 1,
        completedUnits: 1,
        units: [
          {
            index: 0,
            videoStartFrame: 0,
            videoEndFrameExclusive: 1,
            audioStartFrame: 0,
            audioEndFrameExclusive: 1,
            byteLength: 5,
            sha256: 'fixture',
          },
        ],
        updatedAtMs: 1,
      },
    );
    const recreated = new IndexedDbResumableMuxedExportStore({ databaseName });
    expect(await recreated.loadManifest('job')).toMatchObject({ completedUnits: 1 });
    expect(await recreated.loadUnit('job', 0)).toEqual({
      index: 0,
      init: new Uint8Array([1, 2]),
      media: new Uint8Array([3, 4, 5]),
    });
    await recreated.delete('job');
  });

  it('encodes one complete fragmented MP4 unit', async () => {
    const sink = new SeekableMemorySink();
    const result = await exportResumableMuxed({
      key: 'single-mp4-unit',
      contentId: 'single-mp4-unit',
      profile: 'mp4-h264-aac',
      store: new MemoryResumableMuxedExportStore(),
      durationUs: 2_000_000,
      segmentDurationUs: 2_000_000,
      width: 96,
      height: 54,
      frameRate: { numerator: 30, denominator: 1 },
      sampleRate: 48_000,
      channelCount: 2,
      videoBitrate: 300_000,
      audioBitrate: 128_000,
      renderFrame,
      renderAudio,
      sink: sink.writable,
    });
    expect(result.totalUnits).toBe(1);
    expect((await createSampleIndex(sink.finalize())).container).toBe('mp4');
  });

  it.each([
    { profile: 'webm-vp9-opus' as const, container: 'webm' },
    { profile: 'mp4-h264-aac' as const, container: 'mp4' },
  ])(
    'reuses only committed $profile units after 25%, 50% and 90% interruption',
    async ({ profile, container }) => {
      const base = {
        contentId: 'deterministic-av-v1',
        profile,
        durationUs: 2_000_000,
        segmentDurationUs: 200_000,
        width: 96,
        height: 54,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: 300_000,
        audioBitrate: 128_000,
        renderFrame,
        renderAudio,
      } as const;
      const referenceSink = new SeekableMemorySink();
      const reference = await exportResumableMuxed({
        ...base,
        key: `reference-${profile}`,
        store: new MemoryResumableMuxedExportStore(),
        sink: referenceSink.writable,
      });
      const referenceBytes = referenceSink.finalize();
      const expected = await semanticSignature(referenceBytes);
      expect((await createSampleIndex(referenceBytes)).container).toBe(container);

      for (const committedTarget of [Math.ceil(reference.totalUnits * 0.25), 5, 9]) {
        const store = new MemoryResumableMuxedExportStore();
        const interruptedSink = new SeekableMemorySink();
        await expect(
          exportResumableMuxed({
            ...base,
            key: `resume-${profile}-${committedTarget.toString()}`,
            store,
            sink: interruptedSink.writable,
            onUnitCommitted: completed => {
              if (completed === committedTarget) throw new Error('simulated interruption');
            },
          }),
        ).rejects.toThrow('simulated interruption');

        const renderedOnResume: number[] = [];
        const resumedSink = new SeekableMemorySink();
        const resumed = await exportResumableMuxed({
          ...base,
          key: `resume-${profile}-${committedTarget.toString()}`,
          store,
          sink: resumedSink.writable,
          renderFrame: request => {
            renderedOnResume.push(request.frameIndex);
            return renderFrame(request);
          },
        });
        expect(resumed.reusedUnits).toBe(committedTarget);
        expect(resumed.encodedUnits).toBe(reference.totalUnits - committedTarget);
        expect(renderedOnResume.every(frame => frame >= committedTarget * 6)).toBe(true);
        expect(await semanticSignature(resumedSink.finalize())).toEqual(expected);
      }
    },
  );
});
