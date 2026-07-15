import { canonicalStringify, type AelionProject, type ItemEntity } from '@aelion/project-schema';
import type { JsonObject } from '@aelion/core';

import type {
  IrAudioClip,
  IrClip,
  IrMaterialDefinition,
  IrMaterialInstance,
  IrMediaSource,
  IrNestedSequenceSource,
  IrTextClip,
  IrTimeMapping,
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

function jsonObject(value: unknown, context: string): JsonObject {
  return object(value, context) as JsonObject;
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
  const streamType = string(stream.type, 'stream.type');
  if (streamType !== 'video' && streamType !== 'audio') {
    throw new TypeError(`Unsupported stream type ${streamType}`);
  }
  const boundary = string(timeMapping.boundary, 'timeMapping.boundary');
  if (!['error', 'hold', 'loop', 'transparent'].includes(boundary)) {
    throw new TypeError(`Unsupported boundary ${boundary}`);
  }
  let compiledTimeMapping: IrTimeMapping;
  if (timeMapping.type === 'linear') {
    const rate = object(timeMapping.rate, `item ${item.id}.source.timeMapping.rate`);
    compiledTimeMapping = {
      type: 'linear',
      rate: {
        numerator: number(rate.numerator, 'rate.numerator'),
        denominator: number(rate.denominator, 'rate.denominator'),
      },
      reverse: boolean(timeMapping.reverse, 'timeMapping.reverse'),
    };
  } else if (timeMapping.type === 'curve') {
    if (!Array.isArray(timeMapping.points))
      throw new TypeError('timeMapping.points must be an array');
    compiledTimeMapping = {
      type: 'curve',
      points: timeMapping.points.map((value, index) => {
        const point = object(value, `timeMapping.points[${index.toString()}]`);
        const interpolation = string(point.interpolation, 'timeMapping point interpolation');
        if (interpolation !== 'linear' && interpolation !== 'hold' && interpolation !== 'cubic') {
          throw new TypeError(`Unsupported TimeMap interpolation ${interpolation}`);
        }
        return {
          itemTimeUs: number(point.itemTimeUs, 'timeMapping point itemTimeUs'),
          sourceTimeUs: number(point.sourceTimeUs, 'timeMapping point sourceTimeUs'),
          interpolation,
        };
      }),
    };
  } else {
    throw new TypeError(`Unsupported time mapping for ${item.id}`);
  }
  return {
    assetId: string(source.assetId, 'source.assetId'),
    streamType,
    streamIndex: number(stream.index, 'stream.index'),
    sourceRange: {
      startUs: number(sourceRange.startUs, 'sourceRange.startUs'),
      durationUs: number(sourceRange.durationUs, 'sourceRange.durationUs'),
    },
    timeMapping: compiledTimeMapping,
    ...(compiledTimeMapping.type === 'linear'
      ? { rate: compiledTimeMapping.rate, reverse: compiledTimeMapping.reverse }
      : {}),
    boundary: boundary as IrMediaSource['boundary'],
  };
}

function nestedSequenceSource(item: ItemEntity): IrNestedSequenceSource {
  const source = object(item.source, `item ${item.id}.source`);
  const sourceRange = object(source.sourceRange, `item ${item.id}.source.sourceRange`);
  const timeMapping = object(source.timeMapping, `item ${item.id}.source.timeMapping`);
  const boundary = string(timeMapping.boundary, 'timeMapping.boundary');
  if (!['error', 'hold', 'loop', 'transparent'].includes(boundary)) {
    throw new TypeError(`Unsupported boundary ${boundary}`);
  }
  let compiledTimeMapping: IrTimeMapping;
  if (timeMapping.type === 'linear') {
    const rate = object(timeMapping.rate, `item ${item.id}.source.timeMapping.rate`);
    compiledTimeMapping = {
      type: 'linear',
      rate: {
        numerator: number(rate.numerator, 'rate.numerator'),
        denominator: number(rate.denominator, 'rate.denominator'),
      },
      reverse: boolean(timeMapping.reverse, 'timeMapping.reverse'),
    };
  } else if (timeMapping.type === 'curve') {
    if (!Array.isArray(timeMapping.points))
      throw new TypeError('timeMapping.points must be an array');
    compiledTimeMapping = {
      type: 'curve',
      points: timeMapping.points.map((value, index) => {
        const point = object(value, `timeMapping.points[${index.toString()}]`);
        const interpolation = string(point.interpolation, 'timeMapping point interpolation');
        if (interpolation !== 'linear' && interpolation !== 'hold' && interpolation !== 'cubic') {
          throw new TypeError(`Unsupported TimeMap interpolation ${interpolation}`);
        }
        return {
          itemTimeUs: number(point.itemTimeUs, 'timeMapping point itemTimeUs'),
          sourceTimeUs: number(point.sourceTimeUs, 'timeMapping point sourceTimeUs'),
          interpolation,
        };
      }),
    };
  } else {
    throw new TypeError(`Unsupported nested Sequence time mapping for ${item.id}`);
  }
  return {
    sequenceId: string(source.sequenceId, `item ${item.id}.source.sequenceId`),
    sourceRange: {
      startUs: number(sourceRange.startUs, 'sourceRange.startUs'),
      durationUs: number(sourceRange.durationUs, 'sourceRange.durationUs'),
    },
    timeMapping: compiledTimeMapping,
    boundary: boundary as IrNestedSequenceSource['boundary'],
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
  const base = {
    id: item.id,
    trackId: item.trackId,
    range: { ...item.range },
    enabled: item.enabled,
    materialInstanceIds: [...item.materialInstanceIds],
    dependencyEntityIds: [item.id, ...item.materialInstanceIds],
    fingerprint: clipFingerprint(item, materials),
  };
  if (item.type === 'video' || item.type === 'image') {
    const source = mediaSource(item);
    const visual = object(item.visual, `item ${item.id}.visual`);
    const mask = object(visual.mask ?? {}, `item ${item.id}.visual.mask`);
    const maskSourceId =
      typeof mask.sourceItemId === 'string' && mask.sourceItemId.length > 0
        ? mask.sourceItemId
        : undefined;
    return {
      ...base,
      dependencyEntityIds: [
        ...base.dependencyEntityIds,
        source.assetId,
        ...(maskSourceId === undefined ? [] : [maskSourceId]),
      ],
      kind: 'visual-clip',
      source,
      visual: visual as unknown as IrVisualProperties,
    };
  }
  if (item.type === 'audio') {
    const source = mediaSource(item);
    return {
      ...base,
      dependencyEntityIds: [...base.dependencyEntityIds, source.assetId],
      kind: 'audio-clip',
      source,
      audio: object(item.audio, `item ${item.id}.audio`) as IrAudioClip['audio'],
    };
  }
  if (item.type === 'text') {
    const box = object(item.box, `item ${item.id}.box`);
    const paragraphs = item.paragraphs;
    if (!Array.isArray(paragraphs))
      throw new TypeError(`item ${item.id}.paragraphs must be an array`);
    return {
      ...base,
      kind: 'text-clip',
      role: 'text',
      box: {
        x: number(box.x, 'text box.x'),
        y: number(box.y, 'text box.y'),
        width: number(box.width, 'text box.width'),
        height: number(box.height, 'text box.height'),
      },
      overflow: string(item.overflow, 'text overflow') as IrTextClip['overflow'],
      writingMode: string(item.writingMode, 'text writingMode') as IrTextClip['writingMode'],
      paragraphs: paragraphs.map((paragraphValue, paragraphIndex) => {
        const paragraph = object(paragraphValue, `paragraphs[${paragraphIndex.toString()}]`);
        if (!Array.isArray(paragraph.runs))
          throw new TypeError('text paragraph.runs must be an array');
        return {
          style: jsonObject(paragraph.style, 'text paragraph.style'),
          runs: paragraph.runs.map((runValue, runIndex) => {
            const run = object(runValue, `text run[${runIndex.toString()}]`);
            return {
              text: string(run.text, 'text run.text'),
              style: jsonObject(run.style, 'text run.style'),
            };
          }),
        };
      }),
      visual: object(item.visual, `item ${item.id}.visual`) as unknown as IrVisualProperties,
    };
  }
  if (item.type === 'caption') {
    const box = object(item.box, `item ${item.id}.box`);
    return {
      ...base,
      kind: 'text-clip',
      role: 'caption',
      box: {
        x: number(box.x, 'caption box.x'),
        y: number(box.y, 'caption box.y'),
        width: number(box.width, 'caption box.width'),
        height: number(box.height, 'caption box.height'),
      },
      overflow: item.overflow === 'clip' ? 'clip' : 'auto-fit',
      writingMode: 'horizontal-tb',
      paragraphs: [
        {
          style: jsonObject(item.style, `item ${item.id}.style`),
          runs: [
            {
              text: string(item.text, `item ${item.id}.text`),
              style: jsonObject(item.style, `item ${item.id}.style`),
            },
          ],
        },
      ],
      visual: object(item.visual, `item ${item.id}.visual`) as unknown as IrVisualProperties,
    };
  }
  if (item.type === 'nested-sequence') {
    const source = nestedSequenceSource(item);
    return {
      ...base,
      kind: 'nested-sequence-clip',
      source,
      dependencyEntityIds: [...base.dependencyEntityIds, source.sequenceId],
      visual: object(item.visual, `item ${item.id}.visual`) as unknown as IrVisualProperties,
    };
  }
  if (item.type === 'generator') {
    return {
      ...base,
      kind: 'generator-clip',
      generator: jsonObject(item.generator, `item ${item.id}.generator`),
      visual: object(item.visual, `item ${item.id}.visual`) as unknown as IrVisualProperties,
    };
  }
  if (item.type === 'adjustment') {
    return {
      ...base,
      kind: 'adjustment-clip',
      visual: object(item.visual, `item ${item.id}.visual`) as unknown as IrVisualProperties,
    };
  }
  throw new TypeError(`Render IR cannot compile item type ${item.type}`);
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
      const nestedSequenceStack = options.nestedSequenceStack ?? [];
      if (nestedSequenceStack.includes(sequenceId)) {
        throw new TypeError(
          `NESTED_SEQUENCE_CYCLE: ${[...nestedSequenceStack, sequenceId].join(' -> ')}`,
        );
      }
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
          if (
            item.type !== 'video' &&
            item.type !== 'image' &&
            item.type !== 'audio' &&
            item.type !== 'text' &&
            item.type !== 'caption' &&
            item.type !== 'nested-sequence' &&
            item.type !== 'generator' &&
            item.type !== 'adjustment'
          )
            return [];
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
      const nestedSequenceIds = new Set(
        tracks.flatMap(track =>
          track.clips.flatMap(clip =>
            clip.kind === 'nested-sequence-clip' ? [clip.source.sequenceId] : [],
          ),
        ),
      );
      const subgraphs = Object.fromEntries(
        [...nestedSequenceIds].map(nestedSequenceId => [
          nestedSequenceId,
          new IncrementalRenderCompiler().compile(project, nestedSequenceId, revision, {
            ...(options.resolveMaterialProgram === undefined
              ? {}
              : { resolveMaterialProgram: options.resolveMaterialProgram }),
            nestedSequenceStack: [...nestedSequenceStack, sequenceId],
          }).ir,
        ]),
      );
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
        transferFunction:
          format.transferFunction === 'gamma22' ||
          format.transferFunction === 'pq' ||
          format.transferFunction === 'hlg'
            ? format.transferFunction
            : 'srgb',
        bitDepth: format.bitDepth === 10 ? 10 : 8,
        backgroundColor: jsonObject(format.backgroundColor, 'format.backgroundColor'),
        durationUs:
          duration.mode === 'fixed'
            ? number(duration.durationUs, 'duration.durationUs')
            : contentDuration(project, sequence.trackIds),
        tracks,
        transitions,
        materials,
        subgraphs,
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
