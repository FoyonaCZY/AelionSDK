import { describe, expect, it } from 'vitest';

import { pitchPreservingTimeStretch, StreamingPitchPreservingTimeStretch } from '../src/index.js';

function sine(frames: number, frequency: number, sampleRate: number): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, frame) => Math.sin((frame * 2 * Math.PI * frequency) / sampleRate) * 0.8,
  );
}

function dominantFrequency(
  samples: Float32Array,
  sampleRate: number,
  minimum = 250,
  maximum = 1_200,
): number {
  let bestFrequency = minimum;
  let bestPower = Number.NEGATIVE_INFINITY;
  for (let frequency = minimum; frequency <= maximum; frequency += 5) {
    let real = 0;
    let imaginary = 0;
    for (let frame = 0; frame < samples.length; frame += 1) {
      const window = Math.sin((Math.PI * (frame + 0.5)) / samples.length) ** 2;
      const phase = (frame * 2 * Math.PI * frequency) / sampleRate;
      const value = (samples[frame] ?? 0) * window;
      real += value * Math.cos(phase);
      imaginary -= value * Math.sin(phase);
    }
    const power = real * real + imaginary * imaginary;
    if (power > bestPower) {
      bestPower = power;
      bestFrequency = frequency;
    }
  }
  return bestFrequency;
}

describe('pitch-preserving time stretch', () => {
  it('compresses duration without doubling a steady tone pitch', () => {
    const sampleRate = 48_000;
    const input = sine(8_192, 440, sampleRate);
    const stretched = pitchPreservingTimeStretch({
      input,
      inputFrames: input.length,
      outputFrames: input.length / 2,
      channelCount: 1,
    });
    const varispeed = Float32Array.from(
      { length: input.length / 2 },
      (_, frame) => input[frame * 2] ?? 0,
    );

    expect(dominantFrequency(stretched, sampleRate)).toBeGreaterThanOrEqual(420);
    expect(dominantFrequency(stretched, sampleRate)).toBeLessThanOrEqual(460);
    expect(dominantFrequency(varispeed, sampleRate)).toBeGreaterThanOrEqual(850);
  });

  it('is deterministic for stereo expansion and reverse playback', () => {
    const input = Float32Array.from({ length: 2_048 }, (_, index) =>
      index % 2 === 0 ? Math.sin(index / 20) : Math.cos(index / 23),
    );
    const options = {
      input,
      inputFrames: 1_024,
      outputFrames: 2_048,
      channelCount: 2,
      reverse: true,
    } as const;
    const first = pitchPreservingTimeStretch(options);
    const second = pitchPreservingTimeStretch(options);
    expect(first).toEqual(second);
    expect(first).toHaveLength(4_096);
    expect(first.every(Number.isFinite)).toBe(true);
  });

  it('keeps grain phase continuous across arbitrary source chunks', () => {
    const input = sine(12_000, 440, 48_000);
    const reference = pitchPreservingTimeStretch({
      input,
      inputFrames: input.length,
      outputFrames: 8_000,
      channelCount: 1,
    });
    const streaming = new StreamingPitchPreservingTimeStretch({
      inputFrames: input.length,
      outputFrames: 8_000,
      channelCount: 1,
    });
    const boundaries = [0, 13, 1_337, 4_096, 8_101, input.length];
    const output: number[] = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index] ?? 0;
      const end = boundaries[index + 1] ?? 0;
      output.push(...streaming.push(input.subarray(start, end), index === boundaries.length - 2));
    }
    expect(Float32Array.from(output)).toEqual(reference);
    expect(dominantFrequency(reference, 48_000)).toBeGreaterThanOrEqual(420);
    expect(dominantFrequency(reference, 48_000)).toBeLessThanOrEqual(460);
  });
});
