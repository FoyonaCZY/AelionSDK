import type { RenderIr } from '@aelion/render-ir';
import { describe, expect, it } from 'vitest';

import { measureAvSync, renderIrAudio } from '../src/index.js';

const ir: RenderIr = {
  irVersion: '1.0.0',
  projectId: 'audio-test',
  sequenceId: 'sequence',
  revision: 0n,
  width: 320,
  height: 180,
  frameRate: { numerator: 30, denominator: 1 },
  sampleRate: 48_000,
  channelLayout: 'stereo',
  workingColorSpace: 'srgb-linear',
  durationUs: 1_000_000,
  tracks: [
    {
      id: 'audio',
      kind: 'audio',
      enabled: true,
      materialInstanceIds: [],
      fingerprint: 'track',
      clips: [
        {
          id: 'clip',
          kind: 'audio-clip',
          trackId: 'audio',
          range: { startUs: 0, durationUs: 1_000_000 },
          enabled: true,
          materialInstanceIds: [],
          dependencyEntityIds: ['clip', 'asset'],
          fingerprint: 'clip',
          source: {
            assetId: 'asset',
            streamType: 'audio',
            streamIndex: 0,
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
            rate: { numerator: 1, denominator: 1 },
            reverse: false,
            boundary: 'error',
          },
          audio: { gainDb: -6, pan: 0 },
        },
      ],
    },
  ],
  transitions: [],
  materials: {},
};

describe('Render IR audio mixer and A/V oracle', () => {
  it('evaluates and mixes PCM from the same sequence/sample time base', async () => {
    const output = await renderIrAudio({
      ir,
      startFrame: 0,
      frameCount: 480,
      channelCount: 2,
      source: {
        pcmRange: (_assetId, _streamIndex, _startUs, durationUs) => {
          const frames = Math.ceil((durationUs * 48_000) / 1_000_000);
          return Promise.resolve({
            sampleRate: 48_000,
            channelCount: 1,
            frameCount: frames,
            interleaved: new Float32Array(frames).fill(1),
          });
        },
      },
    });
    expect(output).toHaveLength(960);
    expect(output[0]).toBeCloseTo(10 ** (-6 / 20) / Math.SQRT2, 5);
    expect(output[1]).toBeCloseTo(output[0] ?? 0, 7);
  });

  it('renders silence without reading media when an audio track is muted', async () => {
    let reads = 0;
    const muted: RenderIr = {
      ...ir,
      tracks: ir.tracks.map(track => ({
        ...track,
        audio: { gainDb: 0, pan: 0, muted: true },
      })),
    };
    const output = await renderIrAudio({
      ir: muted,
      startFrame: 0,
      frameCount: 480,
      channelCount: 2,
      source: {
        pcmRange: () => {
          reads += 1;
          return Promise.reject(new Error('muted media must not be read'));
        },
      },
    });

    expect(reads).toBe(0);
    expect(output.every(sample => sample === 0)).toBe(true);
  });

  it('splits loop-boundary PCM reads instead of requiring the media provider to wrap', async () => {
    const looping: RenderIr = {
      ...ir,
      tracks: ir.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => ({
          ...clip,
          source: {
            ...clip.source,
            sourceRange: { startUs: 0, durationUs: 10_000 },
            boundary: 'loop' as const,
          },
        })),
      })),
    };
    const reads: { readonly startUs: number; readonly durationUs: number }[] = [];
    const output = await renderIrAudio({
      ir: looping,
      startFrame: 384,
      frameCount: 192,
      channelCount: 2,
      source: {
        pcmRange: (_assetId, _streamIndex, startUs, durationUs) => {
          reads.push({ startUs, durationUs });
          expect(startUs + durationUs).toBeLessThanOrEqual(10_000);
          const frameCount = Math.ceil((durationUs * 48_000) / 1_000_000);
          return Promise.resolve({
            sampleRate: 48_000,
            channelCount: 1,
            frameCount,
            interleaved: new Float32Array(frameCount).fill(1),
          });
        },
      },
    });

    expect(reads).toEqual([
      { startUs: 8_000, durationUs: 2_000 },
      { startUs: 0, durationUs: 2_000 },
    ]);
    expect(output.every(sample => sample !== 0)).toBe(true);
  });

  it('covers every requested frame when the block ends between integer microseconds', async () => {
    const output = await renderIrAudio({
      ir,
      startFrame: 1_024,
      frameCount: 4,
      channelCount: 2,
      source: {
        pcmRange: (_assetId, _streamIndex, _startUs, durationUs) => {
          const frameCount = Math.ceil((durationUs * 48_000) / 1_000_000);
          return Promise.resolve({
            sampleRate: 48_000,
            channelCount: 1,
            frameCount,
            interleaved: new Float32Array(frameCount).fill(1),
          });
        },
      },
    });

    expect(output).toHaveLength(8);
    expect(output.every(sample => sample !== 0)).toBe(true);
  });

  it('does not mix a source sample into both sides of a fractional loop boundary', async () => {
    const looping: RenderIr = {
      ...ir,
      tracks: ir.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => ({
          ...clip,
          source: {
            ...clip.source,
            sourceRange: { startUs: 0, durationUs: 10_001 },
            boundary: 'loop' as const,
          },
          audio: { gainDb: -20, pan: 0 },
        })),
      })),
    };
    const output = await renderIrAudio({
      ir: looping,
      startFrame: 384,
      frameCount: 192,
      channelCount: 2,
      source: {
        pcmRange: (_assetId, _streamIndex, _startUs, durationUs) => {
          const frameCount = Math.ceil((durationUs * 48_000) / 1_000_000);
          return Promise.resolve({
            sampleRate: 48_000,
            channelCount: 1,
            frameCount,
            interleaved: new Float32Array(frameCount).fill(1),
          });
        },
      },
    });
    const expected = 10 ** (-20 / 20) / Math.SQRT2;

    expect(output.every(sample => Math.abs(sample - expected) < 1e-6)).toBe(true);
  });

  it.each([0, 1, 29, 30, 299, 899])(
    'keeps CFR video frame %s within one audio sample of the hardware clock',
    frameIndex => {
      const videoTimestampUs = Math.floor((frameIndex * 1_000_000) / 30);
      const audioFrame = Math.floor((videoTimestampUs * 48_000) / 1_000_000);
      const sample = measureAvSync(videoTimestampUs, audioFrame, 48_000);
      expect(Math.abs(sample.driftUs)).toBeLessThanOrEqual(21);
    },
  );
});
