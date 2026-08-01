import { describe, expect, it } from 'vitest';

import { createProject } from '../src/project-builder.js';
import { buildRateEnvelope } from '../src/rate-envelope.js';

describe('buildRateEnvelope', () => {
  it('builds a single-segment envelope to two endpoints', () => {
    const points = buildRateEnvelope({ segments: [{ rate: 1, durationUs: 2_000_000 }] });
    expect(points).toEqual([
      { itemTimeUs: 0, sourceTimeUs: 0, interpolation: 'linear' },
      { itemTimeUs: 2_000_000, sourceTimeUs: 2_000_000, interpolation: 'linear' },
    ]);
  });

  it('integrates rates across segments (half then double speed)', () => {
    const points = buildRateEnvelope({
      segments: [
        { rate: 0.5, durationUs: 2_000_000 },
        { rate: 2, durationUs: 1_000_000 },
      ],
    });
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ itemTimeUs: 0, sourceTimeUs: 0, interpolation: 'linear' });
    expect(points[1]).toEqual({
      itemTimeUs: 2_000_000,
      sourceTimeUs: 1_000_000,
      interpolation: 'linear',
    });
    expect(points[2]).toEqual({
      itemTimeUs: 3_000_000,
      sourceTimeUs: 3_000_000,
      interpolation: 'linear',
    });
  });

  it('is deterministic and order-independent in mapping', () => {
    const a = buildRateEnvelope({ segments: [{ rate: 0.25, durationUs: 4_000_000 }] });
    const b = buildRateEnvelope({ segments: [{ rate: 0.25, durationUs: 4_000_000 }] });
    expect(a).toEqual(b);
  });

  it('rejects empty envelopes and negative rates', () => {
    expect(() => buildRateEnvelope({ segments: [] })).toThrow(/at least one segment/);
    expect(() => buildRateEnvelope({ segments: [{ rate: -1, durationUs: 1_000 }] })).toThrow(
      /non-negative/,
    );
  });

  it('handles a zero-duration segment by skipping it', () => {
    const points = buildRateEnvelope({
      segments: [
        { rate: 1, durationUs: 1_000_000 },
        { rate: 3, durationUs: 0 },
        { rate: 1, durationUs: 1_000_000 },
      ],
    });
    expect(points).toHaveLength(3);
    expect(points[2]).toEqual({
      itemTimeUs: 2_000_000,
      sourceTimeUs: 2_000_000,
      interpolation: 'linear',
    });
  });
});

describe('addMediaClip curve time mapping', () => {
  it('builds a schema-valid media clip with curve points', () => {
    const builder = createProject({ sequenceId: 'main', width: 320, height: 180 });
    builder.addAsset({ id: 'asset_video', kind: 'video' });
    const trackId = builder.addTrack({ kind: 'visual' });
    const itemId = builder.addMediaClip({
      kind: 'video',
      assetId: 'asset_video',
      trackId,
      durationUs: 3_000_000,
      curvePoints: [
        { itemTimeUs: 0, sourceTimeUs: 0 },
        { itemTimeUs: 1_000_000, sourceTimeUs: 2_000_000 },
        { itemTimeUs: 3_000_000, sourceTimeUs: 4_000_000, interpolation: 'cubic' },
      ],
    });
    const project = builder.build();
    const item = project.items[itemId];
    expect(item?.source?.timeMapping).toEqual({
      type: 'curve',
      points: [
        { itemTimeUs: 0, sourceTimeUs: 0, interpolation: 'linear' },
        { itemTimeUs: 1_000_000, sourceTimeUs: 2_000_000, interpolation: 'linear' },
        { itemTimeUs: 3_000_000, sourceTimeUs: 4_000_000, interpolation: 'cubic' },
      ],
      boundary: 'hold',
    });
  });

  it('rejects rate and curvePoints together', () => {
    const builder = createProject({ sequenceId: 'main' });
    builder.addAsset({ id: 'asset_video', kind: 'video' });
    const trackId = builder.addTrack({ kind: 'visual' });
    expect(() =>
      builder.addMediaClip({
        kind: 'video',
        assetId: 'asset_video',
        trackId,
        durationUs: 1_000_000,
        rate: { numerator: 1, denominator: 1 },
        curvePoints: [{ itemTimeUs: 0, sourceTimeUs: 0 }],
      }),
    ).toThrow(/mutually exclusive/);
  });

  it('compiles a rate envelope into a schema-valid curve clip', () => {
    const builder = createProject({ sequenceId: 'main', width: 320, height: 180 });
    builder.addAsset({ id: 'asset_video', kind: 'video' });
    const trackId = builder.addTrack({ kind: 'visual' });
    const points = buildRateEnvelope({
      segments: [{ rate: 0.5, durationUs: 2_000_000 }],
    });
    const itemId = builder.addMediaClip({
      kind: 'video',
      assetId: 'asset_video',
      trackId,
      durationUs: 2_000_000,
      curvePoints: points,
    });
    const project = builder.build();
    expect(project.items[itemId]?.source?.timeMapping).toMatchObject({ type: 'curve' });
  });
});
