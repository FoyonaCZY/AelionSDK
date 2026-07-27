import { describe, expect, it } from 'vitest';

import { resampleInterleavedPcm, StreamingPcmResampler } from '../src/index.js';

function signal(frames: number, channels: number, sampleRate: number): Float32Array {
  return Float32Array.from({ length: frames * channels }, (_, index) => {
    const frame = Math.floor(index / channels);
    const channel = index % channels;
    return Math.sin((frame * 2 * Math.PI * (220 + channel * 31)) / sampleRate) * 0.75;
  });
}

describe('streaming PCM resampler', () => {
  it.each([
    { inputRate: 44_100, outputRate: 48_000 },
    { inputRate: 48_000, outputRate: 44_100 },
    { inputRate: 96_000, outputRate: 48_000 },
  ])(
    'is sample-identical across arbitrary blocks at $inputRate → $outputRate',
    ({ inputRate, outputRate }) => {
      for (const channels of [1, 2, 6, 8]) {
        const input = signal(4_417, channels, inputRate);
        const reference = resampleInterleavedPcm(input, {
          inputSampleRate: inputRate,
          outputSampleRate: outputRate,
          channelCount: channels,
        });
        const streaming = new StreamingPcmResampler({
          inputSampleRate: inputRate,
          outputSampleRate: outputRate,
          channelCount: channels,
        });
        const boundaries = [0, 1, 7, 64, 511, 1_777, 4_000, 4_417];
        const chunks: Float32Array[] = [];
        for (let index = 0; index < boundaries.length - 1; index += 1) {
          const start = boundaries[index] ?? 0;
          const end = boundaries[index + 1] ?? 0;
          chunks.push(
            streaming.push(
              input.subarray(start * channels, end * channels),
              index === boundaries.length - 2,
            ),
          );
        }
        expect(Float32Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(reference);
        expect(streaming.outputFrames).toBe(Math.floor((4_417 * outputRate) / inputRate));
      }
    },
  );

  it.each([
    { inputRate: 44_100, outputRate: 48_000 },
    { inputRate: 48_000, outputRate: 44_100 },
    { inputRate: 96_000, outputRate: 48_000 },
  ])(
    'keeps the rendered audio end within 1 ms at $inputRate → $outputRate',
    ({ inputRate, outputRate }) => {
      const inputFrames = inputRate * 3 + 17;
      const output = resampleInterleavedPcm(signal(inputFrames, 8, inputRate), {
        inputSampleRate: inputRate,
        outputSampleRate: outputRate,
        channelCount: 8,
      });
      const inputEndUs = (inputFrames * 1_000_000) / inputRate;
      const outputEndUs = ((output.length / 8) * 1_000_000) / outputRate;
      expect(Math.abs(outputEndUs - inputEndUs)).toBeLessThan(1_000);
    },
  );
});
