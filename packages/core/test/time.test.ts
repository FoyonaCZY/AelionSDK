import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  frameDurationUs,
  frameIndexAtTime,
  frameStartUs,
  normalizeRational,
  sampleBoundaryUs,
  sampleCountForRange,
  sampleIndexAtTime,
} from '../src/index.js';

const FRAME_RATES = [
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30, denominator: 1 },
  { numerator: 50, denominator: 1 },
  { numerator: 60, denominator: 1 },
  { numerator: 24_000, denominator: 1_001 },
  { numerator: 30_000, denominator: 1_001 },
  { numerator: 60_000, denominator: 1_001 },
] as const;

describe('rational time', () => {
  it('normalizes rational values', () => {
    expect(normalizeRational({ numerator: 60_000, denominator: 2_002 })).toEqual({
      numerator: 30_000,
      denominator: 1_001,
    });
  });

  it.each(FRAME_RATES)('keeps frame boundaries monotonic for $numerator/$denominator', rate => {
    let previous = -1;
    for (let frame = 0; frame < 10_000; frame += 1) {
      const current = frameStartUs(frame, rate);
      expect(current).toBeGreaterThan(previous);
      expect(frameDurationUs(frame, rate)).toBeGreaterThan(0);
      expect(frameIndexAtTime(current, rate)).toBe(frame);
      previous = current;
    }
  });

  it('does not accumulate rounded frame durations', () => {
    const rate = { numerator: 30_000, denominator: 1_001 };
    expect(frameStartUs(30_000, rate)).toBe(1_001_000_000);
    const durations = new Set(
      Array.from({ length: 30 }, (_, frame) => frameDurationUs(frame, rate)),
    );
    expect(durations).toEqual(new Set([33_366, 33_367]));
  });

  it('maps every frame start back to its exact index', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FRAME_RATES),
        fc.integer({ min: 0, max: 250_000 }),
        (rate, frame) => frameIndexAtTime(frameStartUs(frame, rate), rate) === frame,
      ),
      { numRuns: 2_000, seed: 0xa3110 },
    );
  });
});

describe('audio sample boundaries', () => {
  it.each([44_100, 48_000, 96_000])('maps exact second boundaries at %i Hz', sampleRate => {
    expect(sampleIndexAtTime(10_000_000, sampleRate)).toBe(sampleRate * 10);
    expect(sampleBoundaryUs(sampleRate * 10, sampleRate)).toBe(10_000_000);
    expect(sampleCountForRange(0, 10_000_000, sampleRate)).toBe(sampleRate * 10);
  });

  it('allocates remainder across adjacent blocks without drift', () => {
    const sampleRate = 44_100;
    const blockUs = 10_000;
    let total = 0;
    for (let block = 0; block < 1_000; block += 1) {
      total += sampleCountForRange(block * blockUs, blockUs, sampleRate);
    }
    expect(total).toBe(sampleRate * 10);
  });

  it('keeps sample index monotonic for all safe tested times', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(44_100, 48_000, 96_000),
        fc.integer({ min: 0, max: 3_600_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (sampleRate, start, delta) =>
          sampleIndexAtTime(start + delta, sampleRate) >= sampleIndexAtTime(start, sampleRate),
      ),
      { numRuns: 2_000, seed: 0xa3111 },
    );
  });
});
