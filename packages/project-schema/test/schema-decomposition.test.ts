import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { JsonObject, JsonValue } from '@aelionsdk/core';

import { ProjectValidator, snapshotProjectInput } from '../src/index.js';
import { decomposeProjectSchema } from '../src/schema-decomposition.js';

/**
 * Proves the split validator decides exactly what the whole-document one does.
 *
 * Checking a Project as a shell plus one validator per entity is only sound
 * because a collection map says nothing about its values beyond "this is an
 * entity". That is a property of the schema, not of the code, so it is checked
 * against the schema that actually ships -- and against an Ajv compiled from
 * the same document in one piece, which is the definition being preserved.
 */

const root = new URL('../../../', import.meta.url);
const read = (path: string): JsonObject =>
  JSON.parse(readFileSync(new URL(path, root), 'utf8')) as JsonObject;

const projectSchema = read('schemas/project/v2.0/project.schema.json');
const materialInstanceSchema = read('schemas/material/v1/instance.schema.json');
const baseProject = read('examples/aelion-vertical-slice-30s.project.json');

const validator = new ProjectValidator({ projectSchema, materialInstanceSchema });

const whole = (() => {
  const ajv = new Ajv2020({
    allErrors: false,
    allowUnionTypes: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);
  ajv.addSchema(materialInstanceSchema);
  return ajv.compile(projectSchema);
})();

function freshAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: false,
    allowUnionTypes: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);
  ajv.addSchema(materialInstanceSchema);
  ajv.compile(projectSchema);
  return ajv;
}

/** Migrates the shipped v1 example onto the v2.0 identity the schema pins. */
function currentProject(): JsonObject {
  const value = JSON.parse(JSON.stringify(baseProject)) as JsonObject;
  value.$schema = 'https://schemas.aelion.dev/project/v2.0.json';
  value.schemaVersion = '2.0.0';
  return value;
}

/**
 * Asserts the split and whole-document validators reach the same verdict.
 *
 * Admission runs first and rejects values the schema never sees -- an unsafe
 * integer, a shared object -- so those cases only assert that the document is
 * refused at all. Everything that reaches the schema layer has to be decided
 * identically.
 */
function agrees(candidate: JsonValue): void {
  const result = validator.validate(candidate);
  let admitted: JsonValue;
  try {
    admitted = snapshotProjectInput(candidate);
  } catch {
    expect(result.ok).toBe(false);
    return;
  }
  const wholeSaysValid = whole(admitted);
  const splitSaysSchemaInvalid =
    !result.ok && result.diagnostics.some(entry => entry.code === 'PROJECT_SCHEMA_INVALID');
  expect(splitSaysSchemaInvalid).toBe(!wholeSaysValid);
}

describe('decomposeProjectSchema', () => {
  it('accepts the shipped Project schema and dispatches Items by type', () => {
    const decomposed = decomposeProjectSchema(freshAjv(), projectSchema);
    expect(decomposed).toBeDefined();
    const items = decomposed?.byCollection.get('items');
    expect(items?.kind).toBe('discriminated');
    if (items?.kind !== 'discriminated') return;
    expect(items.property).toBe('type');
    expect([...items.byValue.keys()].sort()).toStrictEqual(
      [
        'adjustment',
        'audio',
        'caption',
        'gap',
        'generator',
        'image',
        'material-content',
        'nested-sequence',
        'shape',
        'text',
        'video',
      ].sort(),
    );
  });

  it.each([
    [
      'a map that names its values inline instead of by reference',
      (schema: JsonObject): void => {
        (schema.$defs as JsonObject).markerMap = {
          type: 'object',
          additionalProperties: { type: 'object' },
        };
      },
    ],
    [
      'a map with an annotation keyword that reaches into its values',
      (schema: JsonObject): void => {
        (schema.$defs as JsonObject).markerMap = {
          ...((schema.$defs as JsonObject).markerMap as JsonObject),
          unevaluatedProperties: false,
        };
      },
    ],
    [
      'a map that also matches keys by pattern',
      (schema: JsonObject): void => {
        (schema.$defs as JsonObject).markerMap = {
          ...((schema.$defs as JsonObject).markerMap as JsonObject),
          patternProperties: { '^x_': { type: 'object' } },
        };
      },
    ],
    [
      'a document without an identity to hang entity references on',
      (schema: JsonObject): void => {
        delete schema.$id;
      },
    ],
  ])('refuses %s', (_label, breakSchema) => {
    const variant = JSON.parse(JSON.stringify(projectSchema)) as JsonObject;
    breakSchema(variant);
    expect(decomposeProjectSchema(freshAjv(), variant)).toBeUndefined();
  });

  it('stops dispatching when a union branch pins no constant of its own', () => {
    // Two branches that could both match one document is exactly what `oneOf`
    // exists to reject, so the union has to be run whole. The entity split is
    // still sound and still applies -- only the dispatch inside it is dropped.
    const variant = JSON.parse(JSON.stringify(projectSchema)) as JsonObject;
    (variant.$defs as JsonObject).gapItem = { type: 'object' };
    const decomposed = decomposeProjectSchema(freshAjv(), variant);
    expect(decomposed?.byCollection.get('items')?.kind).toBe('single');
    expect(decomposed?.byCollection.get('tracks')?.kind).toBe('single');
  });

  it('still validates correctly through a schema it refuses to split', () => {
    const variant = JSON.parse(JSON.stringify(projectSchema)) as JsonObject;
    delete variant.$id;
    const fallback = new ProjectValidator({ projectSchema: variant, materialInstanceSchema });
    expect(fallback.validate(currentProject()).ok).toBe(true);
    const broken = currentProject();
    delete (broken.items as JsonObject).item_opening;
    expect(fallback.validate(broken).ok).toBe(false);
  });
});

describe('split validation agrees with whole-document validation', () => {
  it('accepts the unmodified document', () => {
    expect(whole(currentProject())).toBe(true);
    agrees(currentProject());
  });

  const breakages: [string, (project: JsonObject) => void][] = [
    [
      'an Item whose type names no branch',
      project => {
        ((project.items as JsonObject).item_opening as JsonObject).type = 'hologram';
      },
    ],
    [
      'an Item with no type at all',
      project => {
        delete ((project.items as JsonObject).item_opening as JsonObject).type;
      },
    ],
    [
      'an Item whose type is not a string',
      project => {
        ((project.items as JsonObject).item_opening as JsonObject).type = 7;
      },
    ],
    [
      'an Item wearing one type over another type body',
      project => {
        ((project.items as JsonObject).item_opening as JsonObject).type = 'text';
      },
    ],
    [
      'an Item missing a field its own branch requires',
      project => {
        delete ((project.items as JsonObject).item_opening as JsonObject).source;
      },
    ],
    [
      'an Item carrying a field no branch evaluates',
      project => {
        ((project.items as JsonObject).item_opening as JsonObject).hologram = true;
      },
    ],
    [
      'an entity key that is not a valid id',
      project => {
        const items = project.items as JsonObject;
        items['not a valid id'] = JSON.parse(JSON.stringify(items.item_opening)) as JsonValue;
      },
    ],
    [
      'an empty Sequence map',
      project => {
        project.sequences = {};
      },
    ],
    [
      'a root field that does not belong',
      project => {
        project.hologram = true;
      },
    ],
    [
      'a missing root field',
      project => {
        delete project.markers;
      },
    ],
    [
      'a Track with the wrong kind',
      project => {
        ((project.tracks as JsonObject).track_video as JsonObject).kind = 'hologram';
      },
    ],
    [
      'a Material instance missing its package identity',
      project => {
        const instances = project.materialInstances as JsonObject;
        const first = Object.values(instances)[0] as JsonObject | undefined;
        if (first !== undefined) delete (first.definition as JsonObject).packageId;
        else project.materialInstances = { mat: { id: 'mat' } };
      },
    ],
    [
      'a time that is not a safe integer',
      project => {
        (((project.items as JsonObject).item_opening as JsonObject).range as JsonObject).startUs =
          2 ** 60;
      },
    ],
    [
      'a collection that is not an object',
      project => {
        project.markers = [];
      },
    ],
  ];

  it.each(breakages)('agrees about %s', (_label, breakProject) => {
    const project = currentProject();
    breakProject(project);
    agrees(project);
  });

  it('agrees on randomly damaged documents', () => {
    const paths: [string, string][] = [
      ['items', 'item_opening'],
      ['items', 'item_music'],
      ['tracks', 'track_video'],
      ['sequences', 'seq_vertical'],
      ['assets', Object.keys(baseProject.assets as JsonObject)[0] ?? 'missing'],
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...paths),
        fc.string({ maxLength: 12 }),
        fc.oneof(
          fc.constant(undefined),
          fc.jsonValue({ maxDepth: 2 }),
          fc.constantFrom('video', 'audio', 'text', 'gap', 'shape', ''),
        ),
        ([collection, id], key, value) => {
          const project = currentProject();
          const owner = project[collection] as JsonObject | undefined;
          const entity = owner?.[id] as JsonObject | undefined;
          if (owner === undefined || entity === undefined || key === '') return;
          // Rebuilt without the key rather than deleted from, so the damage is
          // a plain object literal either way.
          owner[id] =
            value === undefined
              ? (Object.fromEntries(
                  Object.entries(entity).filter(([name]) => name !== key),
                ) as JsonValue)
              : ({ ...entity, [key]: value } as JsonValue);
          agrees(project);
        },
      ),
      { numRuns: 500 },
    );
  });
});
