import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import type { Diagnostic, JsonObject, JsonValue, Result } from '@aelion/core';
import { err, ok } from '@aelion/core';

import { COLLECTION_NAMES, type AelionProject, type CollectionName } from './types.js';
import { ProjectInputAdmissionError, snapshotProjectInput } from './admission.js';

const MAX_PROJECT_DIAGNOSTICS = 64;

interface DiagnosticSink {
  push(...diagnostics: Diagnostic[]): number;
}

class BoundedDiagnosticCollector implements DiagnosticSink {
  readonly #diagnostics: Diagnostic[] = [];
  #truncated = false;

  public get diagnostics(): readonly Diagnostic[] {
    return this.#diagnostics;
  }

  public push(...diagnostics: Diagnostic[]): number {
    for (const diagnostic of diagnostics) {
      if (this.#diagnostics.length < MAX_PROJECT_DIAGNOSTICS - 1) {
        this.#diagnostics.push(diagnostic);
      } else if (!this.#truncated) {
        this.#diagnostics.push({
          code: 'PROJECT_DIAGNOSTICS_TRUNCATED',
          severity: 'error',
          message: `Project validation produced more than ${MAX_PROJECT_DIAGNOSTICS.toString()} diagnostics`,
          recoverable: false,
        });
        this.#truncated = true;
      }
    }
    return this.#diagnostics.length;
  }
}

export interface ProjectValidatorOptions {
  readonly projectSchema: JsonObject;
  readonly materialInstanceSchema: JsonObject;
}

export interface ProjectValidationSuccess {
  readonly project: AelionProject;
}

function schemaDiagnostic(error: ErrorObject): Diagnostic {
  const path = error.instancePath
    .split('/')
    .slice(1)
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  return {
    code: 'PROJECT_SCHEMA_INVALID',
    severity: 'error',
    message: error.message ?? 'Project does not conform to its JSON Schema',
    path,
    recoverable: false,
    details: {
      keyword: error.keyword,
      schemaPath: error.schemaPath,
      params: error.params as JsonValue,
    },
  };
}

function semanticDiagnostic(
  code: string,
  message: string,
  path: readonly (string | number)[],
  entityId?: string,
): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    path,
    ...(entityId === undefined ? {} : { entityId }),
    recoverable: false,
  };
}

function validateEntityMap(
  project: AelionProject,
  collection: CollectionName,
  diagnostics: DiagnosticSink,
): void {
  const entities = project[collection];
  for (const [key, entity] of Object.entries(entities)) {
    if (key !== entity.id) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_ENTITY_KEY_MISMATCH',
          `${collection} key ${key} does not match entity id ${entity.id}`,
          [collection, key, 'id'],
          entity.id,
        ),
      );
    }
  }
}

function requireReference(
  values: Readonly<Record<string, unknown>>,
  id: string,
  expectedCollection: CollectionName,
  path: readonly (string | number)[],
  diagnostics: DiagnosticSink,
): boolean {
  if (Object.hasOwn(values, id)) return true;
  diagnostics.push(
    semanticDiagnostic(
      'PROJECT_REFERENCE_MISSING',
      `Reference ${id} does not exist in ${expectedCollection}`,
      path,
      id,
    ),
  );
  return false;
}

function validateUniqueList(
  values: readonly string[],
  path: readonly (string | number)[],
  diagnostics: DiagnosticSink,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_DUPLICATE_REFERENCE',
          `Duplicate reference ${value}`,
          [...path, index],
          value,
        ),
      );
    }
    seen.add(value);
  });
}

function validateReferences(project: AelionProject, diagnostics: DiagnosticSink): void {
  requireReference(
    project.sequences,
    project.settings.defaultSequenceId,
    'sequences',
    ['settings', 'defaultSequenceId'],
    diagnostics,
  );

  for (const sequence of Object.values(project.sequences)) {
    validateUniqueList(sequence.trackIds, ['sequences', sequence.id, 'trackIds'], diagnostics);
    validateUniqueList(
      sequence.transitionIds,
      ['sequences', sequence.id, 'transitionIds'],
      diagnostics,
    );
    validateUniqueList(
      sequence.materialInstanceIds,
      ['sequences', sequence.id, 'materialInstanceIds'],
      diagnostics,
    );
    validateUniqueList(sequence.markerIds, ['sequences', sequence.id, 'markerIds'], diagnostics);

    sequence.trackIds.forEach((id, index) => {
      if (
        requireReference(
          project.tracks,
          id,
          'tracks',
          ['sequences', sequence.id, 'trackIds', index],
          diagnostics,
        ) &&
        project.tracks[id]?.sequenceId !== sequence.id
      ) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_HOST_MISMATCH',
            `Track ${id} belongs to another sequence`,
            ['sequences', sequence.id, 'trackIds', index],
            id,
          ),
        );
      }
    });
    sequence.transitionIds.forEach((id, index) =>
      requireReference(
        project.transitions,
        id,
        'transitions',
        ['sequences', sequence.id, 'transitionIds', index],
        diagnostics,
      ),
    );
    sequence.materialInstanceIds.forEach((id, index) =>
      requireReference(
        project.materialInstances,
        id,
        'materialInstances',
        ['sequences', sequence.id, 'materialInstanceIds', index],
        diagnostics,
      ),
    );
    sequence.markerIds.forEach((id, index) =>
      requireReference(
        project.markers,
        id,
        'markers',
        ['sequences', sequence.id, 'markerIds', index],
        diagnostics,
      ),
    );
  }

  for (const track of Object.values(project.tracks)) {
    requireReference(
      project.sequences,
      track.sequenceId,
      'sequences',
      ['tracks', track.id, 'sequenceId'],
      diagnostics,
    );
    validateUniqueList(track.itemIds, ['tracks', track.id, 'itemIds'], diagnostics);
    validateUniqueList(
      track.materialInstanceIds,
      ['tracks', track.id, 'materialInstanceIds'],
      diagnostics,
    );
    track.itemIds.forEach((id, index) => {
      if (
        requireReference(
          project.items,
          id,
          'items',
          ['tracks', track.id, 'itemIds', index],
          diagnostics,
        ) &&
        project.items[id]?.trackId !== track.id
      ) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_HOST_MISMATCH',
            `Item ${id} belongs to another track`,
            ['tracks', track.id, 'itemIds', index],
            id,
          ),
        );
      }
    });
    track.materialInstanceIds.forEach((id, index) =>
      requireReference(
        project.materialInstances,
        id,
        'materialInstances',
        ['tracks', track.id, 'materialInstanceIds', index],
        diagnostics,
      ),
    );
  }

  for (const item of Object.values(project.items)) {
    requireReference(
      project.tracks,
      item.trackId,
      'tracks',
      ['items', item.id, 'trackId'],
      diagnostics,
    );
    validateUniqueList(
      item.materialInstanceIds,
      ['items', item.id, 'materialInstanceIds'],
      diagnostics,
    );
    item.materialInstanceIds.forEach((id, index) =>
      requireReference(
        project.materialInstances,
        id,
        'materialInstances',
        ['items', item.id, 'materialInstanceIds', index],
        diagnostics,
      ),
    );
    if (item.type === 'adjustment' && item.materialInstanceIds.length === 0) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_ADJUSTMENT_EMPTY',
          `Adjustment Item ${item.id} must own at least one Material`,
          ['items', item.id, 'materialInstanceIds'],
          item.id,
        ),
      );
    }
    if (item.type === 'nested-sequence') {
      const source = item.source as { readonly sequenceId?: unknown } | undefined;
      if (typeof source?.sequenceId === 'string') {
        requireReference(
          project.sequences,
          source.sequenceId,
          'sequences',
          ['items', item.id, 'source', 'sequenceId'],
          diagnostics,
        );
      }
    }
    if (item.type === 'image') {
      const source = item.source as { readonly stream?: { readonly type?: unknown } } | undefined;
      if (source?.stream?.type !== 'video') {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_IMAGE_STREAM_INVALID',
            `Image Item ${item.id} must use the visual stream adapter`,
            ['items', item.id, 'source', 'stream', 'type'],
            item.id,
          ),
        );
      }
    }
    const visual = (item as { readonly visual?: unknown }).visual;
    if (visual !== null && typeof visual === 'object' && !Array.isArray(visual)) {
      const mask: unknown = Reflect.get(visual, 'mask');
      if (mask !== null && typeof mask === 'object' && !Array.isArray(mask)) {
        const sourceItemId: unknown = Reflect.get(mask, 'sourceItemId');
        if (typeof sourceItemId === 'string') {
          const exists = requireReference(
            project.items,
            sourceItemId,
            'items',
            ['items', item.id, 'visual', 'mask', 'sourceItemId'],
            diagnostics,
          );
          const sourceTrackId = project.items[sourceItemId]?.trackId;
          const ownerSequenceId = project.tracks[item.trackId]?.sequenceId;
          const sourceSequenceId =
            sourceTrackId === undefined ? undefined : project.tracks[sourceTrackId]?.sequenceId;
          if (exists && (sourceItemId === item.id || sourceSequenceId !== ownerSequenceId)) {
            diagnostics.push(
              semanticDiagnostic(
                'PROJECT_MASK_SOURCE_INVALID',
                `Mask source ${sourceItemId} must be another Item in the same Sequence`,
                ['items', item.id, 'visual', 'mask', 'sourceItemId'],
                item.id,
              ),
            );
          }
        }
      }
    }
    if (item.linkGroupId !== undefined) {
      if (
        requireReference(
          project.linkGroups,
          item.linkGroupId,
          'linkGroups',
          ['items', item.id, 'linkGroupId'],
          diagnostics,
        ) &&
        !project.linkGroups[item.linkGroupId]?.itemIds.includes(item.id)
      ) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_LINK_GROUP_BACKREF_MISSING',
            `LinkGroup ${item.linkGroupId} does not contain Item ${item.id}`,
            ['items', item.id, 'linkGroupId'],
            item.id,
          ),
        );
      }
    }
  }

  for (const group of Object.values(project.linkGroups)) {
    validateUniqueList(group.itemIds, ['linkGroups', group.id, 'itemIds'], diagnostics);
    if (group.itemIds.length < 2) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_LINK_GROUP_TOO_SMALL',
          `LinkGroup ${group.id} must contain at least two Items`,
          ['linkGroups', group.id, 'itemIds'],
          group.id,
        ),
      );
    }
    let sequenceId: string | undefined;
    group.itemIds.forEach((id, index) => {
      if (
        !requireReference(
          project.items,
          id,
          'items',
          ['linkGroups', group.id, 'itemIds', index],
          diagnostics,
        )
      ) {
        return;
      }
      const item = project.items[id];
      if (item?.linkGroupId !== group.id) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_LINK_GROUP_BACKREF_MISSING',
            `Item ${id} does not reference LinkGroup ${group.id}`,
            ['linkGroups', group.id, 'itemIds', index],
            id,
          ),
        );
      }
      const itemSequenceId =
        item === undefined ? undefined : project.tracks[item.trackId]?.sequenceId;
      if (sequenceId === undefined) sequenceId = itemSequenceId;
      else if (itemSequenceId !== undefined && itemSequenceId !== sequenceId) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_LINK_GROUP_SEQUENCE_MISMATCH',
            `LinkGroup ${group.id} cannot span Sequences`,
            ['linkGroups', group.id, 'itemIds', index],
            group.id,
          ),
        );
      }
    });
    for (const id of Object.keys(group.syncOffsetsUs ?? {})) {
      if (!group.itemIds.includes(id)) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_LINK_GROUP_OFFSET_ORPHAN',
            `LinkGroup ${group.id} has an offset for non-member ${id}`,
            ['linkGroups', group.id, 'syncOffsetsUs', id],
            group.id,
          ),
        );
      }
    }
  }

  for (const transition of Object.values(project.transitions)) {
    requireReference(
      project.sequences,
      transition.sequenceId,
      'sequences',
      ['transitions', transition.id, 'sequenceId'],
      diagnostics,
    );
    requireReference(
      project.tracks,
      transition.trackId,
      'tracks',
      ['transitions', transition.id, 'trackId'],
      diagnostics,
    );
    requireReference(
      project.items,
      transition.fromItemId,
      'items',
      ['transitions', transition.id, 'fromItemId'],
      diagnostics,
    );
    requireReference(
      project.items,
      transition.toItemId,
      'items',
      ['transitions', transition.id, 'toItemId'],
      diagnostics,
    );
    requireReference(
      project.materialInstances,
      transition.materialInstanceId,
      'materialInstances',
      ['transitions', transition.id, 'materialInstanceId'],
      diagnostics,
    );
  }
}

function validateNestedSequenceCycles(project: AelionProject, diagnostics: DiagnosticSink): void {
  const edges = new Map<string, { readonly itemId: string; readonly target: string }[]>();
  for (const item of Object.values(project.items)) {
    if (item.type !== 'nested-sequence') continue;
    const owner = project.tracks[item.trackId]?.sequenceId;
    const source = item.source as { readonly sequenceId?: unknown } | undefined;
    if (owner === undefined || typeof source?.sequenceId !== 'string') continue;
    const values = edges.get(owner);
    const edge = { itemId: item.id, target: source.sequenceId };
    if (values === undefined) edges.set(owner, [edge]);
    else values.push(edge);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (sequenceId: string): void => {
    if (visited.has(sequenceId)) return;
    visiting.add(sequenceId);
    stack.push(sequenceId);
    for (const edge of edges.get(sequenceId) ?? []) {
      if (visiting.has(edge.target)) {
        const cycleStart = stack.indexOf(edge.target);
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_NESTED_SEQUENCE_CYCLE',
            `Nested Sequence cycle: ${[...stack.slice(cycleStart), edge.target].join(' -> ')}`,
            ['items', edge.itemId, 'source', 'sequenceId'],
            edge.itemId,
          ),
        );
      } else {
        visit(edge.target);
      }
    }
    stack.pop();
    visiting.delete(sequenceId);
    visited.add(sequenceId);
  };
  for (const sequenceId of Object.keys(project.sequences)) visit(sequenceId);
}

function validateMaterialOwnership(project: AelionProject, diagnostics: DiagnosticSink): void {
  const owners = new Map<string, string>();
  const claim = (instanceId: string, owner: string, path: readonly (string | number)[]): void => {
    if (!Object.hasOwn(project.materialInstances, instanceId)) return;
    const existing = owners.get(instanceId);
    if (existing !== undefined) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_MATERIAL_MULTIPLE_OWNERS',
          `Material instance ${instanceId} is owned by both ${existing} and ${owner}`,
          path,
          instanceId,
        ),
      );
      return;
    }
    owners.set(instanceId, owner);
  };

  for (const sequence of Object.values(project.sequences)) {
    sequence.materialInstanceIds.forEach((id, index) =>
      claim(id, `sequence:${sequence.id}`, [
        'sequences',
        sequence.id,
        'materialInstanceIds',
        index,
      ]),
    );
  }
  for (const track of Object.values(project.tracks)) {
    track.materialInstanceIds.forEach((id, index) =>
      claim(id, `track:${track.id}`, ['tracks', track.id, 'materialInstanceIds', index]),
    );
  }
  for (const item of Object.values(project.items)) {
    item.materialInstanceIds.forEach((id, index) =>
      claim(id, `item:${item.id}`, ['items', item.id, 'materialInstanceIds', index]),
    );
  }
  for (const transition of Object.values(project.transitions)) {
    claim(transition.materialInstanceId, `transition:${transition.id}`, [
      'transitions',
      transition.id,
      'materialInstanceId',
    ]);
  }

  for (const id of Object.keys(project.materialInstances)) {
    if (!owners.has(id)) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_MATERIAL_ORPHAN',
          `Material instance ${id} has no owner`,
          ['materialInstances', id],
          id,
        ),
      );
    }
  }
}

function validateVisualTransitionOverlap(
  project: AelionProject,
  diagnostics: DiagnosticSink,
): void {
  const bySequence = new Map<
    string,
    {
      readonly id: string;
      readonly startUs: bigint;
      readonly endUs: bigint;
    }[]
  >();

  for (const transition of Object.values(project.transitions)) {
    if (transition.kind !== 'visual') continue;
    const startUs = BigInt(transition.range.startUs);
    const interval = {
      id: transition.id,
      startUs,
      endUs: startUs + BigInt(transition.range.durationUs),
    };
    const transitions = bySequence.get(transition.sequenceId);
    if (transitions === undefined) {
      bySequence.set(transition.sequenceId, [interval]);
    } else {
      transitions.push(interval);
    }
  }

  for (const transitions of bySequence.values()) {
    transitions.sort((left, right) => {
      if (left.startUs !== right.startUs) return left.startUs < right.startUs ? -1 : 1;
      if (left.endUs !== right.endUs) return left.endUs < right.endUs ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

    let active = transitions[0];
    for (const transition of transitions.slice(1)) {
      if (active !== undefined && transition.startUs < active.endUs) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_VISUAL_TRANSITION_OVERLAP',
            `Visual transition ${transition.id} overlaps ${active.id} in the same sequence`,
            ['transitions', transition.id, 'range'],
            transition.id,
          ),
        );
      }
      if (active === undefined || transition.startUs >= active.endUs) {
        active = transition;
      } else if (transition.endUs > active.endUs) {
        active = transition;
      }
    }
  }
}

function validateTimeMappingSemantics(project: AelionProject, diagnostics: DiagnosticSink): void {
  for (const item of Object.values(project.items)) {
    if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'nested-sequence') continue;
    const source = item.source as {
      readonly timeMapping?: {
        readonly type?: unknown;
        readonly points?: readonly {
          readonly itemTimeUs?: unknown;
        }[];
      };
    };
    const mapping = source.timeMapping;
    if (mapping?.type !== 'curve' || !Array.isArray(mapping.points)) continue;
    const points = mapping.points as readonly unknown[];
    const pointTime = (value: unknown): unknown =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Reflect.get(value, 'itemTimeUs')
        : undefined;
    const firstTime = pointTime(points[0]);
    const lastTime = pointTime(points.at(-1));
    if (firstTime !== 0 || lastTime !== item.range.durationUs) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_TIME_MAPPING_ENDPOINT_INVALID',
          `Curve TimeMap for ${item.id} must start at 0 and end at the Item duration`,
          ['items', item.id, 'source', 'timeMapping', 'points'],
          item.id,
        ),
      );
    }
    for (let index = 1; index < points.length; index += 1) {
      const previous = pointTime(points[index - 1]);
      const current = pointTime(points[index]);
      if (typeof previous === 'number' && typeof current === 'number' && current <= previous) {
        diagnostics.push(
          semanticDiagnostic(
            'PROJECT_TIME_MAPPING_ORDER_INVALID',
            `Curve TimeMap Item times must strictly increase for ${item.id}`,
            ['items', item.id, 'source', 'timeMapping', 'points', index, 'itemTimeUs'],
            item.id,
          ),
        );
        break;
      }
    }
  }
}

function validateAudioSemantics(project: AelionProject, diagnostics: DiagnosticSink): void {
  for (const item of Object.values(project.items)) {
    if (item.type !== 'audio') continue;
    const audio = (item as { readonly audio?: { fadeInUs?: unknown; fadeOutUs?: unknown } }).audio;
    for (const property of ['fadeInUs', 'fadeOutUs'] as const) {
      const durationUs = audio?.[property];
      if (typeof durationUs !== 'number' || durationUs <= item.range.durationUs) continue;
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_AUDIO_FADE_OUT_OF_RANGE',
          `${property} for audio item ${item.id} cannot exceed the Item duration`,
          ['items', item.id, 'audio', property],
          item.id,
        ),
      );
    }
  }
}

function validateColorSemantics(project: AelionProject, diagnostics: DiagnosticSink): void {
  for (const sequence of Object.values(project.sequences)) {
    const format = sequence.format as {
      readonly workingColorSpace?: unknown;
      readonly transferFunction?: unknown;
      readonly bitDepth?: unknown;
    };
    if (format.transferFunction !== 'pq' && format.transferFunction !== 'hlg') continue;
    if (format.workingColorSpace !== 'rec2020-linear' || format.bitDepth !== 10) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_HDR_FORMAT_INVALID',
          `HDR Sequence ${sequence.id} requires rec2020-linear working space and 10-bit output`,
          ['sequences', sequence.id, 'format'],
          sequence.id,
        ),
      );
    }
  }
}

export class ProjectValidator {
  readonly #schemaValidator: ValidateFunction;

  public constructor(options: ProjectValidatorOptions) {
    const ajv = new Ajv2020({
      allErrors: false,
      allowUnionTypes: true,
      strict: true,
      validateFormats: true,
    });
    addFormats(ajv);
    ajv.addSchema(options.materialInstanceSchema);
    this.#schemaValidator = ajv.compile(options.projectSchema);
  }

  public validate(value: unknown): Result<ProjectValidationSuccess> {
    let admitted;
    try {
      admitted = snapshotProjectInput(value);
    } catch (error) {
      const admission =
        error instanceof ProjectInputAdmissionError
          ? error
          : new ProjectInputAdmissionError(
              'PROJECT_INPUT_INVALID',
              'Project input could not be safely inspected',
              [],
            );
      return err({
        code: admission.code,
        severity: 'error',
        message: admission.message,
        path: admission.path,
        recoverable: false,
      });
    }
    if (!this.#schemaValidator(admitted)) {
      const first = this.#schemaValidator.errors?.[0];
      return err(
        first === undefined
          ? {
              code: 'PROJECT_SCHEMA_INVALID',
              severity: 'error',
              message: 'Project does not conform to its JSON Schema',
              recoverable: false,
            }
          : schemaDiagnostic(first),
      );
    }

    const project = admitted as AelionProject;
    const diagnostics = new BoundedDiagnosticCollector();
    COLLECTION_NAMES.forEach(collection => validateEntityMap(project, collection, diagnostics));
    validateReferences(project, diagnostics);
    validateMaterialOwnership(project, diagnostics);
    validateNestedSequenceCycles(project, diagnostics);
    validateVisualTransitionOverlap(project, diagnostics);
    validateTimeMappingSemantics(project, diagnostics);
    validateAudioSemantics(project, diagnostics);
    validateColorSemantics(project, diagnostics);
    return diagnostics.diagnostics.length === 0 ? ok({ project }) : err(...diagnostics.diagnostics);
  }
}
