import { describe, expect, it } from 'vitest';

import {
  imageSequenceDurationUs,
  imageSequenceFrameIndex,
  type ImageSequenceReference,
} from '../src/index.js';

const sequence: ImageSequenceReference = {
  frameDurationUs: 40_000,
  frameAssetIds: ['frame_a', 'frame_b', 'frame_c'],
};

describe('imageSequenceFrameIndex', () => {
  it('maps item time to the containing frame boundary', () => {
    expect(imageSequenceFrameIndex(sequence, 0)).toBe(0);
    expect(imageSequenceFrameIndex(sequence, 39_999)).toBe(0);
    expect(imageSequenceFrameIndex(sequence, 40_000)).toBe(1);
    expect(imageSequenceFrameIndex(sequence, 79_999)).toBe(1);
    expect(imageSequenceFrameIndex(sequence, 80_000)).toBe(2);
    expect(imageSequenceFrameIndex(sequence, 119_999)).toBe(2);
  });

  it('fails closed at and after the final frame boundary', () => {
    expect(imageSequenceFrameIndex(sequence, 120_000)).toBeUndefined();
    expect(imageSequenceFrameIndex(sequence, 1_000_000)).toBeUndefined();
  });

  it('fails closed for negative, fractional and unsafe times', () => {
    expect(imageSequenceFrameIndex(sequence, -1)).toBeUndefined();
    expect(imageSequenceFrameIndex(sequence, 1.5)).toBeUndefined();
    expect(imageSequenceFrameIndex(sequence, Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it('fails closed for a malformed frame duration', () => {
    expect(imageSequenceFrameIndex({ ...sequence, frameDurationUs: 0 }, 10)).toBeUndefined();
  });
});

describe('imageSequenceDurationUs', () => {
  it('is the frame duration times the frame count', () => {
    expect(imageSequenceDurationUs(sequence)).toBe(120_000);
  });
});
