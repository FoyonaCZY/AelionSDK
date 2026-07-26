export interface PitchPreservingTimeStretchOptions {
  readonly input: Float32Array;
  readonly inputFrames: number;
  readonly outputFrames: number;
  readonly channelCount: number;
  readonly reverse?: boolean;
  /** Analysis grain size. The implementation clamps it to the available input. */
  readonly grainFrames?: number;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function sourceSample(
  input: Float32Array,
  inputFrames: number,
  channelCount: number,
  frame: number,
  channel: number,
  reverse: boolean,
): number {
  const sourceFrame = reverse ? inputFrames - 1 - frame : frame;
  return input[sourceFrame * channelCount + channel] ?? 0;
}

/**
 * Deterministic synchronous overlap-add time stretch.
 *
 * Grains are read at the requested source/output rate but are synthesized at
 * their original sample rate. This keeps steady-state pitch stable while
 * changing duration and is suitable for bounded offline blocks. The function
 * is dependency-free so the same algorithm is used by preview and export.
 */
export function pitchPreservingTimeStretch(
  options: PitchPreservingTimeStretchOptions,
): Float32Array {
  positiveInteger(options.inputFrames, 'inputFrames');
  positiveInteger(options.outputFrames, 'outputFrames');
  positiveInteger(options.channelCount, 'channelCount');
  if (options.input.length !== options.inputFrames * options.channelCount) {
    throw new RangeError('input length does not match inputFrames × channelCount');
  }
  const output = new Float32Array(options.outputFrames * options.channelCount);
  const normalization = new Float32Array(options.outputFrames);
  const requestedGrain = options.grainFrames ?? 1_024;
  positiveInteger(requestedGrain, 'grainFrames');
  const grainFrames = Math.min(options.inputFrames, requestedGrain);
  const synthesisHop = Math.max(1, Math.floor(grainFrames / 4));
  const rate = options.inputFrames / options.outputFrames;
  const reverse = options.reverse === true;
  const overlapFrames = grainFrames - synthesisHop;
  const searchRadius = Math.min(256, synthesisHop);
  const maximumInputStart = Math.max(0, options.inputFrames - grainFrames);
  let previousInputStart = 0;

  for (let outputStart = 0; outputStart < options.outputFrames; outputStart += synthesisHop) {
    const expectedInputStart = Math.max(
      0,
      Math.min(maximumInputStart, Math.round(outputStart * rate)),
    );
    let inputStart = expectedInputStart;
    if (outputStart > 0 && overlapFrames > 0 && maximumInputStart > 0) {
      let bestScore = Number.NEGATIVE_INFINITY;
      const firstCandidate = Math.max(0, expectedInputStart - searchRadius);
      const lastCandidate = Math.min(maximumInputStart, expectedInputStart + searchRadius);
      for (let candidate = firstCandidate; candidate <= lastCandidate; candidate += 1) {
        let cross = 0;
        let previousEnergy = 0;
        let candidateEnergy = 0;
        for (let overlap = 0; overlap < overlapFrames; overlap += 1) {
          const previous = sourceSample(
            options.input,
            options.inputFrames,
            options.channelCount,
            previousInputStart + synthesisHop + overlap,
            0,
            reverse,
          );
          const next = sourceSample(
            options.input,
            options.inputFrames,
            options.channelCount,
            candidate + overlap,
            0,
            reverse,
          );
          cross += previous * next;
          previousEnergy += previous * previous;
          candidateEnergy += next * next;
        }
        const score = cross / Math.sqrt(Math.max(Number.EPSILON, previousEnergy * candidateEnergy));
        if (score > bestScore) {
          bestScore = score;
          inputStart = candidate;
        }
      }
    }
    for (let grainFrame = 0; grainFrame < grainFrames; grainFrame += 1) {
      const outputFrame = outputStart + grainFrame;
      const inputFrame = inputStart + grainFrame;
      if (
        outputFrame < 0 ||
        outputFrame >= options.outputFrames ||
        inputFrame < 0 ||
        inputFrame >= options.inputFrames
      ) {
        continue;
      }
      const phase = (grainFrame + 0.5) / grainFrames;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      normalization[outputFrame] = (normalization[outputFrame] ?? 0) + window;
      for (let channel = 0; channel < options.channelCount; channel += 1) {
        const outputIndex = outputFrame * options.channelCount + channel;
        output[outputIndex] =
          (output[outputIndex] ?? 0) +
          sourceSample(
            options.input,
            options.inputFrames,
            options.channelCount,
            inputFrame,
            channel,
            reverse,
          ) *
            window;
      }
    }
    previousInputStart = inputStart;
  }

  for (let frame = 0; frame < options.outputFrames; frame += 1) {
    const scale = normalization[frame] ?? 0;
    for (let channel = 0; channel < options.channelCount; channel += 1) {
      const index = frame * options.channelCount + channel;
      if (scale > 1e-6) {
        output[index] = (output[index] ?? 0) / scale;
        continue;
      }
      const position = Math.min(options.inputFrames - 1, Math.max(0, frame * rate));
      const first = Math.floor(position);
      const next = Math.min(options.inputFrames - 1, first + 1);
      const fraction = position - first;
      const left = sourceSample(
        options.input,
        options.inputFrames,
        options.channelCount,
        first,
        channel,
        reverse,
      );
      const right = sourceSample(
        options.input,
        options.inputFrames,
        options.channelCount,
        next,
        channel,
        reverse,
      );
      output[index] = left + (right - left) * fraction;
    }
  }
  return output;
}
