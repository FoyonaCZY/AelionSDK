import { canonicalStringify, type AelionProject, type ItemEntity } from '@aelion/project-schema';

import type {
  IrAudioClip,
  IrClip,
  IrMaterialDefinition,
  IrMaterialInstance,
  IrMediaSource,
  IrTrack,
  IrTransition,
  IrVisualProperties,
  RenderIr,
  RenderIrCompilation,
  RenderCompileOptions,
} from './types.js';

function deepFreezePlain<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreezePlain(entry, seen);
  return Object.freeze(value);
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new TypeError(`${context} must be a string`);
  return value;
}

function number(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${context} must be a finite number`);
  }
  return value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${context} must be boolean`);
  return value;
}

function mediaSource(item: ItemEntity): IrMediaSource {
  const source = object(item.source, `item ${item.id}.source`);
  const stream = object(source.stream, `item ${item.id}.source.stream`);
  const sourceRange = object(source.sourceRange, `item ${item.id}.source.sourceRange`);
  const timeMapping = object(source.timeMapping, `item ${item.id}.source.timeMapping`);
  if (timeMapping.type !== 'linear') {
    throw new TypeError(`Phase 0 Render IR only supports linear time mapping for ${item.id}`);
  }
  const rate = object(timeMapping.rate, `item ${item.id}.source.timeMapping.rate`);
  const streamType = string(stream.type, 'stream.type');
  if (streamType !== 'video' && streamType !== 'audio') {
    throw new TypeError(`Unsupported stream type ${streamType}`);
  }
  const boundary = string(timeMapping.boundary, 'timeMapping.boundary');
  if (!['error', 'hold', 'loop', 'transparent'].includes(boundary)) {
    throw new TypeError(`Unsupported boundary ${boundary}`);
  }
  return {
    assetId: string(source.assetId, 'source.assetId'),
    streamType,
    streamIndex: number(stream.index, 'stream.index'),
    sourceRange: {
      startUs: number(sourceRange.startUs, 'sourceRange.startUs'),
      durationUs: number(sourceRange.durationUs, 'sourceRange.durationUs'),
    },
    rate: {
      numerator: number(rate.numerator, 'rate.numerator'),
      denominator: number(rate.denominator, 'rate.denominator'),
    },
    reverse: boolean(timeMapping.reverse, 'timeMapping.reverse'),
    boundary: boundary as IrMediaSource['boundary'],
  };
}

function clipFingerprint(
  item: ItemEntity,
  materials: Readonly<Record<string, IrMaterialInstance>>,
): string {
  return [
    canonicalStringify(item),
    ...item.materialInstanceIds.map(id => materialFingerprint(materials[id])),
  ].join('|');
}

function materialFingerprint(instance: IrMaterialInstance | undefined): string {
  if (instance === undefined) return canonicalStringify(null);
  return canonicalStringify({
    id: instance.id,
    definition: {
      packageId: instance.definition.packageId,
      packageVersion: instance.definition.packageVersion,
      packageIntegrity: instance.definition.packageIntegrity,
      materialId: instance.definition.materialId,
    },
    enabled: instance.enabled,
    previewPolicy: instance.previewPolicy,
    parameters: instance.parameters,
    resourceBindings: instance.resourceBindings,
    inputBindings: instance.inputBindings,
    program:
      instance.program === undefined
        ? null
        : {
            backend: instance.program.backend,
            nodeSet: instance.program.nodeSet,
            graphHash: instance.program.graphHash,
          },
  });
}

function compileClip(
  item: ItemEntity,
  materials: Readonly<Record<string, IrMaterialInstance>>,
): IrClip {
  const source = mediaSource(item);
  const base = {
    id: item.id,
    trackId: item.trackId,
    range: { ...item.range },
    enabled: item.enabled,
    materialInstanceIds: [...item.materialInstanceIds],
    dependencyEntityIds: [item.id, source.assetId, ...item.materialInstanceIds],
    fingerprint: clipFingerprint(item, materials),
  };
  if (item.type === 'video') {
    const visual = object(item.visual, `item ${item.id}.visual`);
    return {
      ...base,
      kind: 'visual-clip',
      source,
      visual: visual as unknown as IrVisualProperties,
    };
  }
  if (item.type === 'audio') {
    return {
      ...base,
      kind: 'audio-clip',
      source,
      audio: object(item.audio, `item ${item.id}.audio`) as IrAudioClip['audio'],
    };
  }
  throw new TypeError(`Phase 0 Render IR cannot compile item type ${item.type}`);
}

function material(
  instance: Record<string, unknown>,
  resolveMaterialProgram: RenderCompileOptions['resolveMaterialProgram'],
): IrMaterialInstance {
  const definition = object(instance.definition, 'material definition');
  const compiledDefinition = {
    packageId: string(definition.packageId, 'definition.packageId'),
    packageVersion: string(definition.packageVersion, 'definition.packageVersion'),
    packageIntegrity: string(definition.packageIntegrity, 'definition.packageIntegrity'),
    materialId: string(definition.materialId, 'definition.materialId'),
  } satisfies IrMaterialDefinition;
  const parameters = object(
    instance.parameters,
    'material.parameters',
  ) as IrMaterialInstance['parameters'];
  const resourceBindings = object(
    instance.resourceBindings ?? {},
    'material.resourceBindings',
  ) as IrMaterialInstance['resourceBindings'];
  const inputBindings = object(
    instance.inputBindings ?? {},
    'material.inputBindings',
  ) as IrMaterialInstance['inputBindings'];
  const program = resolveMaterialProgram?.(compiledDefinition, parameters);
  return {
    id: string(instance.id, 'material.id'),
    definition: compiledDefinition,
    enabled: boolean(instance.enabled, 'material.enabled'),
    previewPolicy:
      instance.previewPolicy === 'skippable-when-degraded' ? 'skippable-when-degraded' : 'required',
    parameters,
    resourceBindings,
    inputBindings,
    ...(program === undefined ? {} : { program }),
  };
}

function contentDuration(project: AelionProject, trackIds: readonly string[]): number {
  return trackIds.reduce((sequenceEnd, trackId) => {
    const track = project.tracks[trackId];
    if (track === undefined) return sequenceEnd;
    return track.itemIds.reduce((trackEnd, itemId) => {
      const item = project.items[itemId];
      return item === undefined
        ? trackEnd
        : Math.max(trackEnd, item.range.startUs + item.range.durationUs);
    }, sequenceEnd);
  }, 0);
}

export class IncrementalRenderCompiler {
  #previous: RenderIr | undefined;
  #compiling = false;

  /**
   * Creates an isolated compiler that reuses this compiler's immutable baseline.
   * Compiling on the fork cannot advance or corrupt the parent baseline; a host
   * can promote the fork only after its surrounding transaction commits.
   */
  public fork(): IncrementalRenderCompiler {
    const fork = new IncrementalRenderCompiler();
    fork.#previous = this.#previous;
    return fork;
  }

  /** Releases the incremental baseline retained for clip/transition reuse. */
  public clear(): void {
    if (this.#compiling) {
      throw new Error('IncrementalRenderCompiler does not support clearing during compilation');
    }
    this.#previous = undefined;
  }

  public compile(
    project: AelionProject,
    sequenceId: string,
    revision: bigint,
    optionsOrAffectedRanges:
      | RenderCompileOptions
      | RenderIrCompilation['stats']['affectedRanges'] = {},
  ): RenderIrCompilation {
    if (this.#compiling) {
      throw new Error('IncrementalRenderCompiler does not support reentrant compilation');
    }
    this.#compiling = true;
    try {
      const options: RenderCompileOptions = Array.isArray(optionsOrAffectedRanges)
        ? { affectedRanges: optionsOrAffectedRanges }
        : (optionsOrAffectedRanges as RenderCompileOptions);
      const sequence = project.sequences[sequenceId];
      if (sequence === undefined) throw new RangeError(`Sequence ${sequenceId} does not exist`);
      const materials = Object.fromEntries(
        Object.entries(project.materialInstances).map(([id, value]) => [
          id,
          material(value, options.resolveMaterialProgram),
        ]),
      );
      let compiledClips = 0;
      let reusedClips = 0;
      let compiledTransitions = 0;
      let reusedTransitions = 0;
      const previousClips = new Map(
        (this.#previous?.tracks ?? []).flatMap(track =>
          track.clips.map(clip => [clip.id, clip] as const),
        ),
      );
      const previousTransitions = new Map(
        (this.#previous?.transitions ?? []).map(value => [value.id, value]),
      );
      const affectedEntityIds = new Set(options.affectedEntityIds ?? []);
      const canReuseByEntity =
        this.#previous !== undefined && options.affectedEntityIds !== undefined;

      const tracks: IrTrack[] = sequence.trackIds.map(trackId => {
        const track = project.tracks[trackId];
        if (track === undefined) throw new RangeError(`Track ${trackId} does not exist`);
        const clips = track.itemIds.flatMap(itemId => {
          const item = project.items[itemId];
          if (item === undefined) throw new RangeError(`Item ${itemId} does not exist`);
          if (item.type !== 'video' && item.type !== 'audio') return [];
          const previous = previousClips.get(itemId);
          if (
            canReuseByEntity &&
            previous !== undefined &&
            !previous.dependencyEntityIds.some(id => affectedEntityIds.has(id))
          ) {
            reusedClips += 1;
            return [previous];
          }
          const candidate = compileClip(item, materials);
          if (previous?.fingerprint === candidate.fingerprint) {
            reusedClips += 1;
            return [previous];
          }
          compiledClips += 1;
          return [candidate];
        });
        return {
          id: track.id,
          kind: track.kind,
          enabled: Boolean(track.enabled),
          ...(track.kind === 'audio'
            ? {
                audio: object(track.audio, `track ${track.id}.audio`) as NonNullable<
                  IrTrack['audio']
                >,
              }
            : {}),
          clips,
          materialInstanceIds: [...track.materialInstanceIds],
          fingerprint: canonicalStringify(track),
        };
      });

      const transitions: IrTransition[] = sequence.transitionIds.map(id => {
        const value = project.transitions[id];
        if (value === undefined) throw new RangeError(`Transition ${id} does not exist`);
        const previous = previousTransitions.get(id);
        if (
          canReuseByEntity &&
          previous !== undefined &&
          !previous.dependencyEntityIds.some(entityId => affectedEntityIds.has(entityId))
        ) {
          reusedTransitions += 1;
          return previous;
        }
        const candidate: IrTransition = {
          id,
          trackId: value.trackId,
          fromItemId: value.fromItemId,
          toItemId: value.toItemId,
          range: { ...value.range },
          materialInstanceId: value.materialInstanceId,
          dependencyEntityIds: [id, value.fromItemId, value.toItemId, value.materialInstanceId],
          fingerprint: [
            canonicalStringify(value),
            materialFingerprint(materials[value.materialInstanceId]),
          ].join('|'),
        };
        if (previous?.fingerprint === candidate.fingerprint) {
          reusedTransitions += 1;
          return previous;
        }
        compiledTransitions += 1;
        return candidate;
      });

      const format = object(sequence.format, 'sequence.format');
      const frameRate = object(format.frameRate, 'sequence.format.frameRate');
      const duration = object(sequence.duration, 'sequence.duration');
      const ir: RenderIr = {
        irVersion: '1.0.0',
        projectId: project.projectId,
        sequenceId,
        revision,
        width: number(format.width, 'format.width'),
        height: number(format.height, 'format.height'),
        frameRate: {
          numerator: number(frameRate.numerator, 'frameRate.numerator'),
          denominator: number(frameRate.denominator, 'frameRate.denominator'),
        },
        sampleRate: number(format.sampleRate, 'format.sampleRate'),
        channelLayout: string(format.channelLayout, 'format.channelLayout'),
        workingColorSpace: string(format.workingColorSpace, 'format.workingColorSpace'),
        durationUs:
          duration.mode === 'fixed'
            ? number(duration.durationUs, 'duration.durationUs')
            : contentDuration(project, sequence.trackIds),
        tracks,
        transitions,
        materials,
      };
      const frozenIr = deepFreezePlain(ir) as RenderIr;
      const stats = deepFreezePlain({
        compiledClips,
        reusedClips,
        compiledTransitions,
        reusedTransitions,
        affectedRanges: (options.affectedRanges ?? []).map(range => ({ ...range })),
      }) as RenderIrCompilation['stats'];
      this.#previous = frozenIr;
      return {
        ir: frozenIr,
        stats,
      };
    } finally {
      this.#compiling = false;
    }
  }
}
