import type {
  ActiveAudioState,
  ActiveVisualState,
  IrBaseClip,
  IrVisualClip,
  IrMaterialInstance,
  EvaluatedMaterialInstance,
  RenderIr,
} from './types.js';

function isAnimation(value: unknown): value is {
  readonly animation: {
    readonly keyframes: readonly {
      readonly timeUs: number;
      readonly value: import('@aelion/core').JsonValue;
      readonly interpolation: string;
    }[];
  };
} {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const animation: unknown = Reflect.get(value, 'animation');
  return (
    animation !== null &&
    !Array.isArray(animation) &&
    typeof animation === 'object' &&
    Array.isArray(Reflect.get(animation, 'keyframes'))
  );
}

function evaluateAnimated(value: import('@aelion/core').JsonValue, timeUs: number) {
  if (!isAnimation(value)) return value;
  const keyframes = value.animation.keyframes;
  if (keyframes.length === 0) return null;
  const right = keyframes.findIndex(keyframe => keyframe.timeUs > timeUs);
  if (right <= 0) return keyframes[Math.max(0, right)]?.value ?? null;
  if (right < 0) return keyframes.at(-1)?.value ?? null;
  const from = keyframes[right - 1];
  const to = keyframes[right];
  if (from === undefined || to === undefined) return null;
  if (
    from.interpolation !== 'linear' ||
    typeof from.value !== 'number' ||
    typeof to.value !== 'number' ||
    to.timeUs === from.timeUs
  ) {
    return from.value;
  }
  const progress = (timeUs - from.timeUs) / (to.timeUs - from.timeUs);
  return from.value + (to.value - from.value) * progress;
}

export function evaluateMaterialInstance(
  material: IrMaterialInstance,
  sequenceTimeUs: number,
  ownerStartUs = 0,
): EvaluatedMaterialInstance {
  const localTimeUs = sequenceTimeUs - ownerStartUs;
  return {
    id: material.id,
    parameters: Object.fromEntries(
      Object.entries(material.parameters).map(([id, value]) => [
        id,
        evaluateAnimated(value, localTimeUs),
      ]),
    ),
    resourceBindings: material.resourceBindings,
    inputBindings: material.inputBindings,
  };
}

function contains(startUs: number, durationUs: number, timeUs: number): boolean {
  return timeUs >= startUs && timeUs < startUs + durationUs;
}

function mapBaseClipSourceTime(
  clip: IrBaseClip & { readonly source: IrVisualClip['source'] },
  sequenceTimeUs: number,
): number | null {
  const localUs = sequenceTimeUs - clip.range.startUs;
  if (localUs < 0 || localUs >= clip.range.durationUs) return null;
  const source = clip.source;
  const scaled = Math.floor((localUs * source.rate.numerator) / source.rate.denominator);
  const sourceOffset = source.reverse ? source.sourceRange.durationUs - 1 - scaled : scaled;
  if (sourceOffset >= 0 && sourceOffset < source.sourceRange.durationUs) {
    return source.sourceRange.startUs + sourceOffset;
  }
  if (source.boundary === 'loop') {
    const wrapped =
      ((sourceOffset % source.sourceRange.durationUs) + source.sourceRange.durationUs) %
      source.sourceRange.durationUs;
    return source.sourceRange.startUs + wrapped;
  }
  if (source.boundary === 'hold') {
    const clamped = Math.max(0, Math.min(source.sourceRange.durationUs - 1, sourceOffset));
    return source.sourceRange.startUs + clamped;
  }
  if (source.boundary === 'transparent') return null;
  throw new RangeError(`Clip ${clip.id} maps outside its sourceRange`);
}

export function mapClipSourceTime(clip: IrVisualClip, sequenceTimeUs: number): number | null {
  return mapBaseClipSourceTime(clip, sequenceTimeUs);
}

function numberProperty(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function objectProperty(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

export function evaluateAudioState(
  ir: RenderIr,
  startUs: number,
  durationUs: number,
): ActiveAudioState {
  if (
    !Number.isSafeInteger(startUs) ||
    !Number.isSafeInteger(durationUs) ||
    startUs < 0 ||
    durationUs <= 0 ||
    startUs + durationUs > ir.durationUs
  ) {
    throw new RangeError('Audio evaluation range is outside the Render IR duration');
  }
  return {
    startUs,
    durationUs,
    clips: ir.tracks
      .filter(
        track =>
          track.kind === 'audio' && track.enabled && objectProperty(track.audio).muted !== true,
      )
      .flatMap(track =>
        track.clips.flatMap(clip => {
          if (clip.kind !== 'audio-clip' || !clip.enabled) return [];
          const overlapStart = Math.max(startUs, clip.range.startUs);
          const overlapEnd = Math.min(
            startUs + durationUs,
            clip.range.startUs + clip.range.durationUs,
          );
          if (overlapStart >= overlapEnd) return [];
          const sourceStartUs = mapBaseClipSourceTime(clip, overlapStart);
          if (sourceStartUs === null) return [];
          const trackAudio = objectProperty(track.audio);
          const gainDb =
            numberProperty(trackAudio.gainDb, 0) + numberProperty(clip.audio.gainDb, 0);
          const pan = numberProperty(trackAudio.pan, 0) + numberProperty(clip.audio.pan, 0);
          return [
            {
              clip,
              sourceStartUs,
              sequenceStartUs: overlapStart,
              durationUs: overlapEnd - overlapStart,
              gain: 10 ** (gainDb / 20),
              pan: Math.max(-1, Math.min(1, pan)),
            },
          ];
        }),
      ),
  };
}

export function evaluateVisualState(ir: RenderIr, timeUs: number): ActiveVisualState {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0 || timeUs >= ir.durationUs) {
    throw new RangeError('timeUs is outside the Render IR duration');
  }
  const clips = ir.tracks
    .filter(track => track.kind === 'visual' && track.enabled)
    .flatMap(track =>
      track.clips
        .filter(
          (clip): clip is IrVisualClip =>
            clip.kind === 'visual-clip' &&
            clip.enabled &&
            contains(clip.range.startUs, clip.range.durationUs, timeUs),
        )
        .map(clip => ({
          clip,
          sourceTimeUs: mapClipSourceTime(clip, timeUs),
          materials: clip.materialInstanceIds.flatMap(id => {
            const value = ir.materials[id];
            return value?.enabled === true ? [value] : [];
          }),
        })),
    );
  const transition = ir.transitions.find(value =>
    contains(value.range.startUs, value.range.durationUs, timeUs),
  );
  const transitionMaterial =
    transition === undefined ? undefined : ir.materials[transition.materialInstanceId];
  return {
    timeUs,
    clips,
    ...(transition === undefined || transitionMaterial?.enabled !== true
      ? {}
      : {
          transition: {
            transition,
            progress: (timeUs - transition.range.startUs) / transition.range.durationUs,
            material: transitionMaterial,
          },
        }),
  };
}
