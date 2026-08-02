import { describe, expect, it } from 'vitest';

import { detectAudioEnergyChanges, detectBeats } from '../src/analysis.js';
import { detectScenes } from '../src/analysis.js';

async function detectScenesCompatibility(options: Parameters<typeof detectAudioEnergyChanges>[0]) {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- This call is the compatibility behavior under test.
  return detectScenes(options);
}

function makeSource(
  sampleRate: number,
  channels: number,
  pcm: Float32Array,
): {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly totalFrames: number;
  readonly readFrames: (startFrame: number, frameCount: number) => Promise<Float32Array>;
} {
  return {
    sampleRate,
    channelCount: channels,
    totalFrames: pcm.length / channels,
    readFrames: (start, count) =>
      Promise.resolve(pcm.slice(start * channels, (start + count) * channels)),
  };
}

function pulseTrain(sampleRate: number, seconds: number, periodSeconds: number): Float32Array {
  const frames = sampleRate * seconds;
  const pcm = new Float32Array(frames);
  const periodFrames = Math.round(periodSeconds * sampleRate);
  const pulseWidth = Math.round(sampleRate * 0.01);
  for (let f = 0; f < frames; f += periodFrames) {
    for (let p = 0; p < pulseWidth && f + p < frames; p += 1) {
      pcm[f + p] = 0.9;
    }
  }
  return pcm;
}

describe('detectBeats', () => {
  it('detects pulses at a known period', async () => {
    const pcm = pulseTrain(8_000, 2, 0.5);
    const result = await detectBeats(makeSource(8_000, 1, pcm));
    // Two 0.5s beats in a 2s clip.
    expect(result.beats.length).toBeGreaterThanOrEqual(2);
    expect(result.beats[0]?.frame).toBeLessThan(8_000);
    expect(result.beats[1]?.frame).toBeGreaterThan(4_000);
  });

  it('reports no beats for silence', async () => {
    const pcm = new Float32Array(8_000 * 2);
    const result = await detectBeats(makeSource(8_000, 1, pcm));
    expect(result.beats).toEqual([]);
  });

  it('respects cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const pcm = pulseTrain(8_000, 1, 0.5);
    await expect(
      detectBeats({ ...makeSource(8_000, 1, pcm), signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('detectScenes', () => {
  it('flags an energy jump as a scene boundary', async () => {
    const sampleRate = 8_000;
    const quiet = new Float32Array(sampleRate).fill(0.01);
    const loud = new Float32Array(sampleRate).fill(0.9);
    const pcm = new Float32Array([...quiet, ...loud]);
    const result = await detectScenesCompatibility(makeSource(sampleRate, 1, pcm));
    expect(result.scenes.length).toBeGreaterThanOrEqual(1);
    expect(result.scenes[0]?.frame).toBeGreaterThanOrEqual(sampleRate * 0.9);
  });

  it('reports no boundaries for a constant signal', async () => {
    const pcm = new Float32Array(8_000 * 2).fill(0.5);
    const result = await detectScenesCompatibility(makeSource(8_000, 1, pcm));
    expect(result.scenes).toEqual([]);
  });

  it('handles a multi-channel source', async () => {
    const sampleRate = 8_000;
    const pcm = new Float32Array(sampleRate * 2 * 2); // 2s stereo
    for (let f = sampleRate; f < sampleRate * 2; f += 1) {
      pcm[f * 2] = 0.8;
      pcm[f * 2 + 1] = 0.8;
    }
    const result = await detectScenesCompatibility(makeSource(sampleRate, 2, pcm));
    expect(result.scenes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detectAudioEnergyChanges', () => {
  it('names audio-only results without claiming video scene detection', async () => {
    const sampleRate = 8_000;
    const pcm = new Float32Array([
      ...new Float32Array(sampleRate).fill(0.01),
      ...new Float32Array(sampleRate).fill(0.9),
    ]);
    const result = await detectAudioEnergyChanges(makeSource(sampleRate, 1, pcm));
    expect(result.changes.length).toBeGreaterThanOrEqual(1);
    expect(Reflect.has(result, 'scenes')).toBe(false);
  });

  it('validates source geometry and reports completion for an empty source', async () => {
    await expect(
      detectAudioEnergyChanges({ ...makeSource(0, 1, new Float32Array()), totalFrames: 0 }),
    ).rejects.toThrow(/sampleRate/);
    const progress: number[] = [];
    const result = await detectAudioEnergyChanges({
      ...makeSource(8_000, 1, new Float32Array()),
      onProgress: value => progress.push(value),
    });
    expect(result.changes).toEqual([]);
    expect(progress).toEqual([1]);
  });
});
