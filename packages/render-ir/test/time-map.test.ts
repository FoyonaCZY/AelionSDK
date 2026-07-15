import type { IrMediaSource } from '@aelion/render-ir';
import { analyzeIrTimeMap, invertIrSourceTime, mapIrSourceTime } from '@aelion/render-ir';
import { describe, expect, it } from 'vitest';

function source(overrides: Partial<IrMediaSource> = {}): IrMediaSource {
  return {
    assetId: 'asset',
    streamType: 'video',
    streamIndex: 0,
    sourceRange: { startUs: 100, durationUs: 100 },
    timeMapping: {
      type: 'linear',
      rate: { numerator: 1, denominator: 1 },
      reverse: false,
    },
    boundary: 'error',
    ...overrides,
  };
}

describe('Render IR TimeMap', () => {
  it('maps rational forward and reverse linear time without floating accumulation', () => {
    const forward = source({
      timeMapping: {
        type: 'linear',
        rate: { numerator: 2, denominator: 1 },
        reverse: false,
      },
    });
    expect(mapIrSourceTime(forward, 50, 0)).toBe(100);
    expect(mapIrSourceTime(forward, 50, 49)).toBe(198);

    const reverse = source({
      timeMapping: {
        type: 'linear',
        rate: { numerator: 2, denominator: 1 },
        reverse: true,
      },
    });
    expect(mapIrSourceTime(reverse, 50, 0)).toBe(199);
    expect(mapIrSourceTime(reverse, 50, 49)).toBe(101);
  });

  it('applies loop, hold, transparent and error source boundaries explicitly', () => {
    const mapping = {
      type: 'linear' as const,
      rate: { numerator: 2, denominator: 1 },
      reverse: false,
    };
    expect(mapIrSourceTime(source({ timeMapping: mapping, boundary: 'loop' }), 100, 75)).toBe(150);
    expect(mapIrSourceTime(source({ timeMapping: mapping, boundary: 'hold' }), 100, 75)).toBe(199);
    expect(
      mapIrSourceTime(source({ timeMapping: mapping, boundary: 'transparent' }), 100, 75),
    ).toBe(null);
    expect(() => mapIrSourceTime(source({ timeMapping: mapping }), 100, 75)).toThrow(
      /outside its sourceRange/u,
    );
  });

  it('evaluates linear, hold, cubic and reverse curve segments deterministically', () => {
    const mapped = source({
      sourceRange: { startUs: 0, durationUs: 1_000 },
      timeMapping: {
        type: 'curve',
        points: [
          { itemTimeUs: 0, sourceTimeUs: 100, interpolation: 'linear' },
          { itemTimeUs: 100, sourceTimeUs: 300, interpolation: 'hold' },
          { itemTimeUs: 200, sourceTimeUs: 300, interpolation: 'cubic' },
          { itemTimeUs: 300, sourceTimeUs: 100, interpolation: 'linear' },
        ],
      },
    });
    expect(mapIrSourceTime(mapped, 300, 50)).toBe(200);
    expect(mapIrSourceTime(mapped, 300, 150)).toBe(300);
    expect(mapIrSourceTime(mapped, 300, 225)).toBe(268);
    expect(mapIrSourceTime(mapped, 300, 250)).toBe(200);
    expect(mapIrSourceTime(mapped, 300, 275)).toBe(131);
  });

  it('returns null outside the half-open Item-local interval', () => {
    const mapped = source();
    expect(mapIrSourceTime(mapped, 100, -1)).toBeNull();
    expect(mapIrSourceTime(mapped, 100, 100)).toBeNull();
  });

  it('reports monotonic segments and inverts forward, reverse, cubic and hold mappings', () => {
    const mapped = source({
      sourceRange: { startUs: 0, durationUs: 1_000 },
      timeMapping: {
        type: 'curve',
        points: [
          { itemTimeUs: 0, sourceTimeUs: 100, interpolation: 'linear' },
          { itemTimeUs: 100, sourceTimeUs: 300, interpolation: 'hold' },
          { itemTimeUs: 200, sourceTimeUs: 300, interpolation: 'cubic' },
          { itemTimeUs: 300, sourceTimeUs: 100, interpolation: 'linear' },
        ],
      },
    });
    expect(analyzeIrTimeMap(mapped, 300).map(value => value.direction)).toEqual([
      'forward',
      'hold',
      'reverse',
    ]);
    expect(invertIrSourceTime(mapped, 300, 300)).toEqual(
      expect.arrayContaining([
        { kind: 'point', itemStartUs: 100, itemEndUs: 100 },
        { kind: 'range', itemStartUs: 100, itemEndUs: 200 },
        { kind: 'point', itemStartUs: 200, itemEndUs: 200 },
      ]),
    );
    const inverse = invertIrSourceTime(mapped, 300, 200);
    expect(inverse[0]?.itemStartUs).toBeCloseTo(50, 5);
    expect(inverse[1]?.itemStartUs).toBeCloseTo(250, 5);

    const reverse = source({
      timeMapping: {
        type: 'linear',
        rate: { numerator: 2, denominator: 1 },
        reverse: true,
      },
    });
    expect(invertIrSourceTime(reverse, 50, 159)).toEqual([
      { kind: 'point', itemStartUs: 20, itemEndUs: 20 },
    ]);
  });

  it('rejects incomplete or unordered curve TimeMaps during segment analysis', () => {
    const incomplete = source({
      timeMapping: {
        type: 'curve',
        points: [
          { itemTimeUs: 1, sourceTimeUs: 100, interpolation: 'linear' },
          { itemTimeUs: 100, sourceTimeUs: 200, interpolation: 'linear' },
        ],
      },
    });
    expect(() => analyzeIrTimeMap(incomplete, 100)).toThrow('complete Item-local interval');
  });
});
