export interface RateEnvelopeSegment {
  /** Playback rate of this segment, e.g. 0.5 for half speed. */
  readonly rate: number;
  /** Duration of the segment on the timeline, in microseconds. */
  readonly durationUs: number;
}

export interface CurvePoint {
  readonly itemTimeUs: number;
  readonly sourceTimeUs: number;
  readonly interpolation: 'linear' | 'hold' | 'cubic';
}

export interface RateEnvelopeOptions {
  readonly segments: readonly RateEnvelopeSegment[];
}

/**
 * Compile a rate envelope (segmented playback speed) into equivalent curve
 * time-mapping points. The envelope integrates rate over timeline time: each
 * segment advances the source time by `rate * durationUs`. Points are strictly
 * increasing in both item and source time, so the curve stays monotonic and
 * invertible.
 *
 * Returns at least two points; a single segment produces the two endpoints.
 */
export function buildRateEnvelope(options: RateEnvelopeOptions): readonly CurvePoint[] {
  if (options.segments.length === 0) {
    throw new RangeError('rate envelope requires at least one segment');
  }
  const points: CurvePoint[] = [];
  let itemTimeUs = 0;
  let sourceTimeUs = 0;
  for (const [index, segment] of options.segments.entries()) {
    if (!Number.isFinite(segment.rate) || segment.rate < 0) {
      throw new RangeError(`segment ${index} rate must be a non-negative finite number`);
    }
    if (!Number.isSafeInteger(segment.durationUs) || segment.durationUs < 0) {
      throw new RangeError(`segment ${index} durationUs must be a non-negative safe integer`);
    }
    if (segment.durationUs === 0) continue;
    if (points.length === 0) {
      points.push({ itemTimeUs: 0, sourceTimeUs: 0, interpolation: 'linear' });
    }
    const advancedUs = segment.rate * segment.durationUs;
    const nextSourceUs = sourceTimeUs + advancedUs;
    if (!Number.isSafeInteger(Math.floor(nextSourceUs))) {
      throw new RangeError(`segment ${index} advances source time past the safe integer range`);
    }
    itemTimeUs += segment.durationUs;
    sourceTimeUs = nextSourceUs;
    points.push({
      itemTimeUs,
      sourceTimeUs: Math.floor(sourceTimeUs),
      interpolation: 'linear',
    });
  }
  if (points.length < 2) {
    points.push({ itemTimeUs: 0, sourceTimeUs: 0, interpolation: 'linear' });
    points.push({ itemTimeUs: 1, sourceTimeUs: 1, interpolation: 'linear' });
  }
  return points;
}
