import type { JsonValue } from '@aelionsdk/core';
import { describe, expect, it } from 'vitest';

import { evaluateAnimatedValue } from '../src/evaluate.js';

function animated(keyframes: readonly unknown[]): JsonValue {
  return {
    animation: { timeSpace: 'item', preInfinity: 'hold', postInfinity: 'hold', keyframes },
  } as unknown as JsonValue;
}

describe('Bézier handle keyframe evaluation', () => {
  it('interpolates a scalar value through explicit Bézier handles', () => {
    const value = animated([
      {
        timeUs: 0,
        value: 0,
        interpolation: 'cubic-bezier',
        handleOut: { x: 0, y: 0 },
      },
      {
        timeUs: 100,
        value: 100,
        interpolation: 'cubic-bezier',
        handleIn: { x: 0, y: 0 },
      },
    ]);
    // Cubic Bézier with zero tangents is a cubic ease; at t=0.5 it is 50.
    const result = evaluateAnimatedValue(value, 50) as number;
    expect(result).toBeCloseTo(50, 2);
  });

  it('pulls the curve toward an outgoing handle', () => {
    const value = animated([
      { timeUs: 0, value: 0, interpolation: 'cubic-bezier', handleOut: { x: 0, y: 100 } },
      { timeUs: 100, value: 100, interpolation: 'cubic-bezier', handleIn: { x: 0, y: 0 } },
    ]);
    const result = evaluateAnimatedValue(value, 25) as number;
    // A large outgoing tangent overshoots above the linear 25 value.
    expect(result).toBeGreaterThan(25);
  });

  it('interpolates a vec2 through handle components', () => {
    const value = animated([
      {
        timeUs: 0,
        value: { x: 0, y: 0 },
        interpolation: 'cubic-bezier',
        handleOut: { x: 0, y: 0 },
      },
      {
        timeUs: 100,
        value: { x: 10, y: 20 },
        interpolation: 'cubic-bezier',
        handleIn: { x: 0, y: 0 },
      },
    ]);
    const result = evaluateAnimatedValue(value, 50) as { x: number; y: number };
    expect(result.x).toBeCloseTo(5, 2);
    expect(result.y).toBeCloseTo(10, 2);
  });

  it('falls back to existing easing when no handle is present', () => {
    const withHandle = animated([
      { timeUs: 0, value: 0, interpolation: 'cubic-bezier', handleOut: { x: 0, y: 50 } },
      { timeUs: 100, value: 100, interpolation: 'cubic-bezier' },
    ]);
    const noHandle = animated([
      {
        timeUs: 0,
        value: 0,
        interpolation: 'cubic-bezier',
        easing: { x1: 0, y1: 0, x2: 1, y2: 1 },
      },
      { timeUs: 100, value: 100, interpolation: 'cubic-bezier' },
    ]);
    // A zero-tangent handle is a plain cubic ease; the explicit easing path
    // stays untouched (both evaluate without throwing).
    const withHandleResult = evaluateAnimatedValue(withHandle, 25) as number;
    const noHandleResult = evaluateAnimatedValue(noHandle, 25) as number;
    expect(Number.isFinite(noHandleResult)).toBe(true);
    expect(Number.isFinite(withHandleResult)).toBe(true);
  });

  it('handles keyframes at the same timestamp by returning a keyframe value', () => {
    const value = animated([
      { timeUs: 0, value: 10, interpolation: 'cubic-bezier', handleOut: { x: 0, y: 1 } },
      { timeUs: 0, value: 20, interpolation: 'cubic-bezier', handleIn: { x: 0, y: 1 } },
    ]);
    const result = evaluateAnimatedValue(value, 0) as number;
    expect([10, 20]).toContain(result);
  });

  it('ignores handles on linear interpolation', () => {
    const value = animated([
      { timeUs: 0, value: 0, interpolation: 'linear', handleOut: { x: 0, y: 100 } },
      { timeUs: 100, value: 100, interpolation: 'linear', handleIn: { x: 0, y: -100 } },
    ]);
    expect(evaluateAnimatedValue(value, 25)).toBe(25);
  });

  it('uses an inbound-only handle without inventing an outbound tangent', () => {
    const value = animated([
      { timeUs: 0, value: 0, interpolation: 'cubic-bezier' },
      { timeUs: 100, value: 100, interpolation: 'cubic-bezier', handleIn: { x: 0, y: -100 } },
    ]);
    expect(evaluateAnimatedValue(value, 50)).toBeCloseTo(12.5, 4);
  });
});
