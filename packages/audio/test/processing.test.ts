import { describe, expect, it } from 'vitest';

import {
  analyzeLoudness,
  applyChannelMatrix,
  buildWaveformPeaks,
  SidechainDucker,
  TruePeakLimiter,
} from '../src/index.js';

describe('production audio processing', () => {
  it('applies explicit channel matrices without implicit layout assumptions', () => {
    const mono = applyChannelMatrix(new Float32Array([1, -1, 0.5, 0.5]), {
      inputChannels: 2,
      outputChannels: 1,
      gains: [0.5, 0.5],
    });
    expect([...mono]).toEqual([0, 0.5]);
  });

  it('keeps sidechain envelope state continuous across adjacent blocks', () => {
    const options = {
      sampleRate: 1_000,
      channelCount: 1,
      thresholdDb: -20,
      reductionDb: -12,
      attackUs: 2_000,
      releaseUs: 10_000,
      lookaheadUs: 2_000,
    } as const;
    const program = new Float32Array(20).fill(1);
    const sidechain = new Float32Array(20);
    sidechain.fill(1, 4, 12);
    const whole = new SidechainDucker(options).process(program, sidechain);
    const splitProcessor = new SidechainDucker(options);
    const first = splitProcessor.process(program.subarray(0, 10), sidechain.subarray(0, 10));
    const second = splitProcessor.process(program.subarray(10), sidechain.subarray(10));
    expect([...first, ...second]).toEqual([...whole]);
    expect(Math.min(...whole)).toBeLessThan(0.5);
  });

  it('reports loudness and limits delayed true peaks below the ceiling', () => {
    const pcm = Float32Array.from(
      { length: 48_000 },
      (_, index) => Math.sin((index * Math.PI * 2 * 1_000) / 48_000) * 0.5,
    );
    const report = analyzeLoudness(pcm, 48_000, 1);
    expect(report.integratedLufs).toBeGreaterThan(-12);
    expect(report.integratedLufs).toBeLessThan(-8);
    expect(report.truePeakDbtp).toBeCloseTo(-6.02, 1);

    const limiter = new TruePeakLimiter({
      sampleRate: 48_000,
      channelCount: 1,
      ceilingDbtp: -1,
      lookaheadUs: 1_000,
      releaseUs: 10_000,
    });
    const limited = limiter.process(new Float32Array(100).fill(2));
    expect(Math.max(...limited)).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    expect(limiter.latencyFrames).toBe(48);
  });

  it('builds cancellable bounded waveform peaks without storing PCM in Project state', async () => {
    const progress: number[] = [];
    const result = await buildWaveformPeaks({
      sampleRate: 1_000,
      channelCount: 1,
      totalFrames: 1_000,
      windowFrames: 10,
      maxPoints: 20,
      readFrames: (start, count) =>
        Promise.resolve(Float32Array.from({ length: count }, (_, index) => (start + index) / 999)),
      onProgress: value => progress.push(value),
    });
    expect(result.windowFrames).toBe(50);
    expect(result.peaks).toHaveLength(20);
    expect(result.peaks[0]).toMatchObject({ startFrame: 0, frameCount: 50, min: [0] });
    expect(result.peaks.at(-1)?.max[0]).toBe(1);
    expect(progress.at(-1)).toBe(1);
  });
});
