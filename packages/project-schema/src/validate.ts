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
    if (item.linkGroupId !== undefined) {
      requireReference(
        project.linkGroups,
        item.linkGroupId,
        'linkGroups',
        ['items', item.id, 'linkGroupId'],
        diagnostics,
      );
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

function validateAlphaAudioSemantics(project: AelionProject, diagnostics: DiagnosticSink): void {
  for (const item of Object.values(project.items)) {
    if (item.type !== 'audio') continue;
    const source = item.source as {
      readonly timeMapping?: {
        readonly type?: unknown;
        readonly rate?: { readonly numerator?: unknown; readonly denominator?: unknown };
        readonly reverse?: unknown;
      };
    };
    const mapping = source.timeMapping;
    const rate = mapping?.rate;
    if (
      mapping?.type !== 'linear' ||
      mapping.reverse !== false ||
      rate?.numerator !== rate?.denominator
    ) {
      diagnostics.push(
        semanticDiagnostic(
          'PROJECT_AUDIO_TIME_MAPPING_UNSUPPORTED',
          `Audio item ${item.id} requires forward 1x linear time mapping in this Alpha`,
          ['items', item.id, 'source', 'timeMapping'],
          item.id,
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
    validateVisualTransitionOverlap(project, diagnostics);
    validateAlphaAudioSemantics(project, diagnostics);
    return diagnostics.diagnostics.length === 0 ? ok({ project }) : err(...diagnostics.diagnostics);
  }
}
