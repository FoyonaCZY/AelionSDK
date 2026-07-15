import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import type { JsonObject } from '@aelion/core';
import type { ItemEntity } from '@aelion/project-schema';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalClone,
  canonicalHash,
  canonicalStringify,
  PROJECT_INPUT_MAX_ARRAY_LENGTH,
  PROJECT_INPUT_MAX_DEPTH,
  PROJECT_INPUT_MAX_OBJECT_KEYS,
  ProjectValidator,
  snapshotProjectInput,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

let project: JsonObject;
let projectSchema: JsonObject;
let validator: ProjectValidator;

function addTransition(
  target: JsonObject,
  options: {
    readonly id: string;
    readonly materialInstanceId: string;
    readonly startUs: number;
    readonly durationUs: number;
    readonly kind?: 'visual' | 'audio';
    readonly sequenceId?: string;
  },
): void {
  const transitions = target.transitions as JsonObject;
  const originalTransition = transitions.transition_ab as JsonObject;
  transitions[options.id] = {
    ...canonicalClone(originalTransition),
    id: options.id,
    kind: options.kind ?? 'visual',
    sequenceId: options.sequenceId ?? 'seq_main',
    range: {
      startUs: options.startUs,
      durationUs: options.durationUs,
    },
    materialInstanceId: options.materialInstanceId,
  };

  const materialInstances = target.materialInstances as JsonObject;
  const originalMaterial = materialInstances.mat_cross_dissolve as JsonObject;
  materialInstances[options.materialInstanceId] = {
    ...canonicalClone(originalMaterial),
    id: options.materialInstanceId,
  };

  const sequences = target.sequences as JsonObject;
  const sequence = sequences[options.sequenceId ?? 'seq_main'] as JsonObject | undefined;
  if (sequence !== undefined) {
    sequence.transitionIds = [
      ...(sequence.transitionIds as JsonObject[keyof JsonObject][]),
      options.id,
    ];
  }
}

beforeAll(async () => {
  const [loadedProjectSchema, materialInstanceSchema, fixture] = await Promise.all([
    readJson('schemas/project/v1/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
    readJson('examples/aelion-project-v1.example.json'),
  ]);
  projectSchema = loadedProjectSchema;
  project = fixture;
  validator = new ProjectValidator({ projectSchema, materialInstanceSchema });
});

describe('Aelion Project v1', () => {
  it('keeps every public collection and array schema within the admission budgets', () => {
    const definitions = projectSchema.$defs as JsonObject;
    const idList = definitions.idList as JsonObject;
    expect(idList.maxItems).toBe(PROJECT_INPUT_MAX_ARRAY_LENGTH);

    const materialInstances = (projectSchema.properties as JsonObject)
      .materialInstances as JsonObject;
    const mapNames = [
      'assetMap',
      'sequenceMap',
      'trackMap',
      'itemMap',
      'transitionMap',
      'markerMap',
      'linkGroupMap',
    ] as const;
    expect(materialInstances.maxProperties).toBe(PROJECT_INPUT_MAX_OBJECT_KEYS);
    for (const name of mapNames) {
      expect((definitions[name] as JsonObject).maxProperties).toBe(PROJECT_INPUT_MAX_OBJECT_KEYS);
    }

    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      const schema = value as Record<string, unknown>;
      if (schema.type === 'array') {
        expect(schema.maxItems).toEqual(expect.any(Number));
        expect(schema.maxItems as number).toBeLessThanOrEqual(PROJECT_INPUT_MAX_ARRAY_LENGTH);
      }
      if (
        schema.type === 'object' &&
        schema.additionalProperties !== undefined &&
        schema.additionalProperties !== false
      ) {
        expect(schema.maxProperties).toEqual(expect.any(Number));
        expect(schema.maxProperties as number).toBeLessThanOrEqual(PROJECT_INPUT_MAX_OBJECT_KEYS);
      }
      for (const entry of Object.values(schema)) visit(entry);
    };
    visit(projectSchema);
  });

  it('validates the canonical full project example', () => {
    const result = validator.validate(project);
    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
  });

  it('accepts optional audio Track solo state and rejects non-boolean values', () => {
    const candidate = canonicalClone(project);
    const track = (candidate.tracks as JsonObject).track_music as JsonObject;
    const audio = track.audio as JsonObject;
    audio.solo = true;
    expect(validator.validate(candidate).ok).toBe(true);

    audio.solo = 'yes';
    const invalid = validator.validate(candidate);
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROJECT_SCHEMA_INVALID' })]),
    );
  });

  it('validates the fixed 30-second vertical-slice Project', async () => {
    const verticalSlice = await readJson('examples/aelion-vertical-slice-30s.project.json');
    const result = validator.validate(verticalSlice);
    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
  });

  it('rejects a dangling normalized reference with a stable diagnostic', () => {
    const broken = canonicalClone(project);
    const sequences = broken.sequences as JsonObject;
    const sequence = sequences.seq_main as JsonObject;
    sequence.trackIds = ['track_missing'];

    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROJECT_REFERENCE_MISSING',
          path: ['sequences', 'seq_main', 'trackIds', 0],
        }),
      ]),
    );
  });

  it('rejects a collection key/id mismatch', () => {
    const broken = canonicalClone(project);
    const items = broken.items as JsonObject;
    const item = items.item_video_a as JsonObject;
    item.id = 'item_other';

    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROJECT_ENTITY_KEY_MISMATCH' })]),
    );
  });

  it('rejects one MaterialInstance being owned by multiple hosts', () => {
    const broken = canonicalClone(project);
    const items = broken.items as JsonObject;
    const secondItem = items.item_video_b as JsonObject;
    secondItem.materialInstanceIds = ['mat_warm_film'];

    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PROJECT_MATERIAL_MULTIPLE_OWNERS' }),
      ]),
    );
  });

  it('requires LinkGroup membership and Item back-references to agree', () => {
    const broken = canonicalClone(project);
    const group = (broken.linkGroups as JsonObject).link_av_a as JsonObject;
    group.itemIds = ['item_video_a'];
    group.syncOffsetsUs = { item_video_a: 0, item_audio_a: 0 };

    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PROJECT_LINK_GROUP_TOO_SMALL' }),
        expect.objectContaining({ code: 'PROJECT_LINK_GROUP_BACKREF_MISSING' }),
        expect.objectContaining({ code: 'PROJECT_LINK_GROUP_OFFSET_ORPHAN' }),
      ]),
    );
  });

  it.each([
    { rate: { numerator: 2, denominator: 1 }, reverse: false },
    { rate: { numerator: 1, denominator: 1 }, reverse: true },
  ])('accepts production audio linear time mapping', value => {
    const candidate = canonicalClone(project);
    const items = candidate.items as JsonObject;
    const item = items.item_audio_a as ItemEntity | undefined;
    if (item === undefined || item.type !== 'audio') throw new Error('Fixture audio is missing');
    const source = item.source as JsonObject;
    const mapping = source.timeMapping as JsonObject;
    mapping.rate = value.rate;
    mapping.reverse = value.reverse;

    expect(validator.validate(candidate).ok).toBe(true);
  });

  it('rejects audio fades longer than the Item', () => {
    const broken = canonicalClone(project);
    const item = (broken.items as JsonObject).item_audio_a as JsonObject;
    const audio = item.audio as JsonObject;
    audio.fadeInUs = 5_200_001;

    const result = validator.validate(broken);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROJECT_AUDIO_FADE_OUT_OF_RANGE',
          entityId: 'item_audio_a',
        }),
      ]),
    );
  });

  it('validates curve TimeMap endpoints and strictly increasing Item-local time', () => {
    const candidate = canonicalClone(project);
    const item = (candidate.items as JsonObject).item_video_a as JsonObject;
    const source = item.source as JsonObject;
    source.timeMapping = {
      type: 'curve',
      boundary: 'error',
      points: [
        { itemTimeUs: 0, sourceTimeUs: 1_000_000, interpolation: 'linear' },
        { itemTimeUs: 2_000_000, sourceTimeUs: 3_000_000, interpolation: 'hold' },
        { itemTimeUs: 5_200_000, sourceTimeUs: 2_000_000, interpolation: 'linear' },
      ],
    };
    expect(validator.validate(candidate).ok).toBe(true);

    const points = (source.timeMapping as JsonObject).points as JsonObject[];
    const last = points.at(-1);
    if (last === undefined) throw new Error('Curve fixture is incomplete');
    last.itemTimeUs = 5_199_999;
    expect(validator.validate(candidate).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PROJECT_TIME_MAPPING_ENDPOINT_INVALID' }),
      ]),
    );

    last.itemTimeUs = 2_000_000;
    expect(validator.validate(candidate).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PROJECT_TIME_MAPPING_ORDER_INVALID' }),
      ]),
    );
  });

  it('rejects overlapping visual Transitions in one Sequence with a stable diagnostic', () => {
    const broken = canonicalClone(project);
    addTransition(broken, {
      id: 'transition_overlap',
      materialInstanceId: 'mat_transition_overlap',
      startUs: 5_000_000,
      durationUs: 400_000,
    });

    const result = validator.validate(broken);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROJECT_VISUAL_TRANSITION_OVERLAP',
          path: ['transitions', 'transition_overlap', 'range'],
          entityId: 'transition_overlap',
          recoverable: false,
        }),
      ]),
    );
  });

  it.each([
    {
      name: 'a visual Transition touching the existing half-open interval boundary',
      kind: 'visual' as const,
      sequenceId: 'seq_main',
      startUs: 5_200_000,
    },
    {
      name: 'an audio Transition in the same Sequence',
      kind: 'audio' as const,
      sequenceId: 'seq_main',
      startUs: 5_000_000,
    },
    {
      name: 'a visual Transition in another Sequence',
      kind: 'visual' as const,
      sequenceId: 'seq_other',
      startUs: 5_000_000,
    },
  ])('allows $name', ({ kind, sequenceId, startUs }) => {
    const candidate = canonicalClone(project);
    if (sequenceId === 'seq_other') {
      const sequences = candidate.sequences as JsonObject;
      const originalSequence = sequences.seq_main as JsonObject;
      sequences.seq_other = {
        ...canonicalClone(originalSequence),
        id: 'seq_other',
        trackIds: [],
        transitionIds: [],
        materialInstanceIds: [],
        markerIds: [],
      };
    }
    addTransition(candidate, {
      id: 'transition_candidate',
      materialInstanceId: 'mat_transition_candidate',
      startUs,
      durationUs: 400_000,
      kind,
      sequenceId,
    });

    const result = validator.validate(candidate);
    expect(
      result.diagnostics.some(
        diagnostic => diagnostic.code === 'PROJECT_VISUAL_TRANSITION_OVERLAP',
      ),
    ).toBe(false);
  });

  it('rejects huge and sparse arrays before Ajv can amplify errors', () => {
    const huge = canonicalClone(project);
    const sequence = (huge.sequences as JsonObject).seq_main as JsonObject;
    sequence.trackIds = new Array(1_000_000) as unknown as JsonObject[keyof JsonObject];
    const hugeResult = validator.validate(huge);
    expect(hugeResult).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_LIMIT_EXCEEDED' })],
    });

    const sparse = canonicalClone(project);
    const sparseSequence = (sparse.sequences as JsonObject).seq_main as JsonObject;
    sparseSequence.trackIds = new Array(
      PROJECT_INPUT_MAX_ARRAY_LENGTH,
    ) as unknown as JsonObject[keyof JsonObject];
    const sparseResult = validator.validate(sparse);
    expect(sparseResult).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_INVALID' })],
    });
    expect(sparseResult.diagnostics).toHaveLength(1);
  });

  it('admits a dense boundary array with one descriptor read per element', () => {
    const values = Array.from({ length: PROJECT_INPUT_MAX_ARRAY_LENGTH }, (_, index) => index);
    let descriptorCalls = 0;
    let ownKeysCalls = 0;
    const proxy = new Proxy(values, {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        descriptorCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expect(snapshotProjectInput(proxy)).toEqual(values);
    expect(ownKeysCalls).toBe(1);
    expect(descriptorCalls).toBe(PROJECT_INPUT_MAX_ARRAY_LENGTH + 1);
  });

  it('accepts JSON.parse containers from another realm', () => {
    const foreign = runInNewContext(
      `JSON.parse(${JSON.stringify(JSON.stringify(project))})`,
    ) as unknown;
    const result = validator.validate(foreign);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  });

  it('rejects class instances and custom object and array prototypes', () => {
    class ProjectContainer {
      public readonly kind = 'custom';
    }
    const customObject = Object.assign(new ProjectContainer(), canonicalClone(project));
    const customPrototypeBase: object = Object.create(Object.prototype) as object;
    const customPrototype: JsonObject = Object.setPrototypeOf(
      canonicalClone(project),
      customPrototypeBase,
    ) as JsonObject;
    class CustomArray<T> extends Array<T> {}

    for (const value of [customObject, customPrototype, new CustomArray('track_a')]) {
      let caught: unknown;
      try {
        snapshotProjectInput(value);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: 'PROJECT_INPUT_INVALID' });
    }
  });

  it('rejects accessors without invoking their getter', () => {
    const accessor = canonicalClone(project);
    let getterCalls = 0;
    Object.defineProperty(accessor, 'metadata', {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error('Project getter must not be called');
      },
    });
    const result = validator.validate(accessor);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_INVALID' })],
    });
    expect(getterCalls).toBe(0);
  });

  it('snapshots Proxy descriptors once and never invokes get traps', () => {
    const candidate = canonicalClone(project);
    let getCalls = 0;
    let descriptorCalls = 0;
    const proxy = new Proxy(candidate, {
      get(target, property, receiver) {
        getCalls += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
      getOwnPropertyDescriptor(target, property) {
        descriptorCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const result = validator.validate(proxy);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(descriptorCalls).toBeGreaterThan(0);
    expect(getCalls).toBe(0);
  });

  it('returns one bounded diagnostic when a Proxy reflection trap fails', () => {
    const proxy = new Proxy(canonicalClone(project), {
      ownKeys(): never {
        throw new Error('untrusted ownKeys trap');
      },
    });
    expect(() => validator.validate(proxy)).not.toThrow();
    const result = validator.validate(proxy);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_INVALID' })],
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it('returns one bounded diagnostic for a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable(canonicalClone(project), {});
    revoke();

    expect(() => validator.validate(proxy)).not.toThrow();
    expect(validator.validate(proxy)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_INVALID' })],
    });
  });

  it('bounds depth, object keys, cycles and shared object aliases', () => {
    const nested: JsonObject = {};
    let cursor = nested;
    for (let depth = 0; depth <= PROJECT_INPUT_MAX_DEPTH; depth += 1) {
      const next: JsonObject = {};
      cursor.next = next;
      cursor = next;
    }
    expect(validator.validate(nested)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_LIMIT_EXCEEDED' })],
    });

    const manyKeys = Object.fromEntries(
      Array.from({ length: PROJECT_INPUT_MAX_OBJECT_KEYS + 1 }, (_, index) => [
        `key_${index.toString()}`,
        index,
      ]),
    );
    expect(validator.validate(manyKeys)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_LIMIT_EXCEEDED' })],
    });

    const cycle: JsonObject = {};
    cycle.self = cycle;
    expect(validator.validate(cycle)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_INVALID' })],
    });
    const shared: JsonObject = {};
    expect(validator.validate({ left: shared, right: shared })).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_INPUT_INVALID' })],
    });
  });

  it('returns only the first Ajv schema diagnostic', () => {
    const result = validator.validate({});
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('PROJECT_SCHEMA_INVALID');
  });

  it('validates nested Sequence references and diagnoses recursive graphs', () => {
    const changed = canonicalClone(project);
    const sequences = changed.sequences as JsonObject;
    const tracks = changed.tracks as JsonObject;
    const items = changed.items as JsonObject;
    const main = sequences.seq_main as JsonObject;
    const titleTrack = tracks.track_title as JsonObject;
    const title = items.item_title as JsonObject;
    sequences.seq_child = {
      ...canonicalClone(main),
      id: 'seq_child',
      trackIds: ['track_child'],
      transitionIds: [],
      materialInstanceIds: [],
      markerIds: [],
    };
    tracks.track_child = {
      ...canonicalClone(titleTrack),
      id: 'track_child',
      sequenceId: 'seq_child',
      itemIds: [],
      materialInstanceIds: [],
    };
    const nested = (id: string, trackId: string, sequenceId: string): JsonObject => ({
      id,
      trackId,
      type: 'nested-sequence',
      enabled: true,
      range: { startUs: 0, durationUs: 1_000_000 },
      materialInstanceIds: [],
      source: {
        sequenceId,
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        timeMapping: {
          type: 'linear',
          rate: { numerator: 1, denominator: 1 },
          reverse: false,
          boundary: 'error',
        },
      },
      visual: canonicalClone(title.visual as JsonObject),
    });
    items.nested_to_child = nested('nested_to_child', 'track_title', 'seq_child');
    titleTrack.itemIds = [...(titleTrack.itemIds as string[]), 'nested_to_child'];
    expect(validator.validate(changed).ok).toBe(true);

    items.nested_to_main = nested('nested_to_main', 'track_child', 'seq_main');
    (tracks.track_child as JsonObject).itemIds = ['nested_to_main'];
    expect(validator.validate(changed)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'PROJECT_NESTED_SEQUENCE_CYCLE' })],
    });
  });
});

describe('canonical serialization', () => {
  it('sorts map keys while preserving semantic array order', () => {
    expect(canonicalStringify({ z: 1, a: 2, order: ['z', 'a'] })).toBe(
      '{"a":2,"order":["z","a"],"z":1}',
    );
  });

  it('is byte stable across parse and serialize', async () => {
    const first = canonicalStringify(project);
    const second = canonicalStringify(JSON.parse(first) as JsonObject);
    expect(second).toBe(first);
    await expect(canonicalHash(project)).resolves.toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0])(
    'rejects non-canonical number %s',
    value => {
      expect(() => canonicalStringify({ value })).toThrow();
    },
  );
});
