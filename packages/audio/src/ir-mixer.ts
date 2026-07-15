import { sampleBoundaryUs, sampleIndexAtTime, throwIfAborted } from '@aelion/core';
import { evaluateAudioState, type RenderIr } from '@aelion/render-ir';

export interface PcmSourceBlock {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly frameCount: number;
  readonly interleaved: Float32Array;
}

export interface IrPcmSource {
  pcmRange(
    assetId: string,
    streamIndex: number,
    startUs: number,
    durationUs: number,
    signal?: AbortSignal,
  ): Promise<PcmSourceBlock>;
}

export interface RenderIrAudioOptions {
  readonly ir: RenderIr;
  readonly startFrame: number;
  readonly frameCount: number;
  readonly channelCount: number;
  readonly source: IrPcmSource;
  readonly signal?: AbortSignal;
}

function gains(gain: number, pan: number): readonly [number, number] {
  const angle = ((pan + 1) * Math.PI) / 4;
  return [gain * Math.cos(angle), gain * Math.sin(angle)];
}

interface PcmRequestSegment {
  readonly sourceStartUs: number;
  readonly sequenceStartUs: number;
  readonly durationUs: number;
}

function sampleBoundaryCeilUs(sampleIndex: number, sampleRate: number): number {
  const floorUs = sampleBoundaryUs(sampleIndex, sampleRate);
  const remainder = (BigInt(sampleIndex) * 1_000_000n) % BigInt(sampleRate);
  const result = floorUs + (remainder === 0n ? 0 : 1);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('PCM request boundary exceeds the safe integer range');
  }
  return result;
}

function pcmRequestSegments(
  active: ReturnType<typeof evaluateAudioState>['clips'][number],
): readonly PcmRequestSegment[] {
  const source = active.clip.source;
  if (
    source.boundary !== 'loop' ||
    source.reverse ||
    source.rate.numerator !== source.rate.denominator
  ) {
    return [
      {
        sourceStartUs: active.sourceStartUs,
        sequenceStartUs: active.sequenceStartUs,
        durationUs: active.durationUs,
      },
    ];
  }

  const sourceRangeEndUs = source.sourceRange.startUs + source.sourceRange.durationUs;
  const segments: PcmRequestSegment[] = [];
  let sourceStartUs = active.sourceStartUs;
  let sequenceStartUs = active.sequenceStartUs;
  let remainingUs = active.durationUs;
  while (remainingUs > 0) {
    const durationUs = Math.min(remainingUs, sourceRangeEndUs - sourceStartUs);
    if (durationUs <= 0) {
      sourceStartUs = source.sourceRange.startUs;
      continue;
    }
    segments.push({ sourceStartUs, sequenceStartUs, durationUs });
    remainingUs -= durationUs;
    sequenceStartUs += durationUs;
    sourceStartUs = source.sourceRange.startUs;
  }
  return segments;
}

export async function renderIrAudio(options: RenderIrAudioOptions): Promise<Float32Array> {
  throwIfAborted(options.signal, 'Render IR audio');
  if (!Number.isSafeInteger(options.startFrame) || options.startFrame < 0) {
    throw new RangeError('startFrame must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(options.frameCount) || options.frameCount <= 0) {
    throw new RangeError('frameCount must be a positive safe integer');
  }
  if (options.channelCount !== 1 && options.channelCount !== 2) {
    throw new RangeError('Phase 0 audio mixer supports mono or stereo output');
  }
  const startUs = sampleBoundaryUs(options.startFrame, options.ir.sampleRate);
  // A microsecond range whose end is floored can be one source sample short
  // whenever the target frame boundary is fractional in microseconds (for
  // example most 48 kHz block boundaries). Cover the complete final target
  // sample; per-segment copy bounds below discard any provider over-read.
  const endUs = sampleBoundaryCeilUs(
    options.startFrame + options.frameCount,
    options.ir.sampleRate,
  );
  const state = evaluateAudioState(options.ir, startUs, endUs - startUs);
  const output = new Float32Array(options.frameCount * options.channelCount);
  await Promise.all(
    state.clips.map(async active => {
      const [leftGain, rightGain] = gains(active.gain, active.pan);
      for (const segment of pcmRequestSegments(active)) {
        const block = await options.source.pcmRange(
          active.clip.source.assetId,
          active.clip.source.streamIndex,
          segment.sourceStartUs,
          segment.durationUs,
          options.signal,
        );
        throwIfAborted(options.signal, 'Render IR audio');
        if (block.sampleRate !== options.ir.sampleRate) {
          throw new Error('Phase 0 mixer requires source PCM at the sequence sample rate');
        }
        const outputOffset =
          sampleIndexAtTime(segment.sequenceStartUs, options.ir.sampleRate) - options.startFrame;
        const segmentEndFrame = sampleIndexAtTime(
          segment.sequenceStartUs + segment.durationUs,
          options.ir.sampleRate,
        );
        const targetFrames = Math.max(
          0,
          Math.min(options.startFrame + options.frameCount, segmentEndFrame) -
            (options.startFrame + outputOffset),
        );
        const frames = Math.min(block.frameCount, targetFrames);
        for (let frame = 0; frame < frames; frame += 1) {
          const sourceLeft = block.interleaved[frame * block.channelCount] ?? 0;
          const sourceRight =
            block.channelCount === 1
              ? sourceLeft
              : (block.interleaved[frame * block.channelCount + 1] ?? sourceLeft);
          const target = (outputOffset + frame) * options.channelCount;
          if (options.channelCount === 1) {
            output[target] =
              (output[target] ?? 0) +
              (sourceLeft * leftGain + sourceRight * rightGain) / Math.SQRT2;
          } else {
            output[target] = (output[target] ?? 0) + sourceLeft * leftGain;
            output[target + 1] = (output[target + 1] ?? 0) + sourceRight * rightGain;
          }
        }
      }
    }),
  );
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, output[index] ?? 0));
  }
  return output;
}

export interface AvSyncSample {
  readonly videoTimestampUs: number;
  readonly audioFrame: number;
  readonly audioTimestampUs: number;
  readonly driftUs: number;
}

export function measureAvSync(
  videoTimestampUs: number,
  audioFrame: number,
  sampleRate: number,
): AvSyncSample {
  const audioTimestampUs = sampleBoundaryUs(audioFrame, sampleRate);
  return {
    videoTimestampUs,
    audioFrame,
    audioTimestampUs,
    driftUs: videoTimestampUs - audioTimestampUs,
  };
}
