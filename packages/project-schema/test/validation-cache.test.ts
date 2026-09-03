import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { JsonObject, JsonValue } from '@aelionsdk/core';
import {
  assertAdmittedProjectInput,
  PROJECT_INPUT_MAX_DEPTH,
  ProjectValidator,
} from '../src/index.js';

/**
 * Tries to make the identity caches report a verdict that is no longer true.
 *
 * Both the bounds walker and the entity schema check remember results by object
 * identity, because a commit hands them the previous snapshot's objects again.
 * That is only sound while a remembered object cannot change, so these tests go
 * after the ways a stale answer could be produced: reusing an id with a
 * different object, mutating something that was measured, moving a measured
 * subtree somewhere its size no longer fits, and carrying a verdict across
 * validators that do not share a schema.
 */

const root = new URL('../../../', import.meta.url);
const read = (path: string): JsonObject =>
  JSON.parse(readFileSync(new URL(path, root), 'utf8')) as JsonObject;

const projectSchema = read('schemas/project/v2.0/project.schema.json');
const materialInstanceSchema = read('schemas/material/v1/instance.schema.json');
const baseProject = read('examples/aelion-vertical-slice-30s.project.json');

function currentProject(): JsonObject {
  const value = JSON.parse(JSON.stringify(baseProject)) as JsonObject;
  value.$schema = 'https://schemas.aelion.dev/project/v2.0.json';
  value.schemaVersion = '2.0.0';
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function validator(): ProjectValidator {
  return new ProjectValidator({ projectSchema, materialInstanceSchema });
}

describe('the entity schema cache cannot go stale', () => {
  it('judges a replacement object rather than trusting the id it reuses', () => {
    const check = validator();
    const good = currentProject();
    deepFreeze(good);
    expect(check.validate(good).ok).toBe(true);

    // Same id, same position, different object -- and broken. Caching by id
    // rather than by identity would wave this through.
    const bad = currentProject();
    delete ((bad.items as JsonObject).item_opening as JsonObject).source;
    deepFreeze(bad);
    expect(check.validate(bad).ok).toBe(false);
  });

  it('re-checks an entity that was accepted while it was still mutable', () => {
    const check = validator();
    const project = currentProject();
    expect(check.validate(project).ok).toBe(true);

    // Never frozen, so nothing about it may be remembered.
    delete ((project.items as JsonObject).item_opening as JsonObject).source;
    expect(check.validate(project).ok).toBe(false);
  });

  it('does not carry a verdict from one schema to another', () => {
    const permissive = JSON.parse(JSON.stringify(projectSchema)) as JsonObject;
    // Accept any Item at all, so this validator accepts a document the shipped
    // schema rejects.
    (permissive.$defs as JsonObject).item = { type: 'object' };
    const loose = new ProjectValidator({ projectSchema: permissive, materialInstanceSchema });
    const strict = validator();

    const project = currentProject();
    delete ((project.items as JsonObject).item_opening as JsonObject).source;
    deepFreeze(project);

    expect(loose.validate(project).ok).toBe(true);
    expect(strict.validate(project).ok).toBe(false);
  });

  it('re-runs the per-Item semantic rules for a replacement object', () => {
    const check = validator();
    const good = currentProject();
    deepFreeze(good);
    expect(check.validate(good).ok).toBe(true);

    // An audio fade longer than the Item is decided by the Item alone, which is
    // exactly the class of rule the per-Item cache skips. A different object
    // under the same id has to be judged on its own.
    const bad = currentProject();
    const music = (bad.items as JsonObject).item_music as JsonObject;
    const range = music.range as JsonObject;
    music.audio = { gainDb: 0, pan: 0, fadeInUs: (range.durationUs as number) + 1_000 };
    deepFreeze(bad);
    const result = check.validate(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('PROJECT_AUDIO_FADE_OUT_OF_RANGE');
  });

  it('does not cache a per-Item verdict reached while the Item was mutable', () => {
    const check = validator();
    const project = currentProject();
    expect(check.validate(project).ok).toBe(true);

    const music = (project.items as JsonObject).item_music as JsonObject;
    const range = music.range as JsonObject;
    music.audio = { gainDb: 0, pan: 0, fadeOutUs: (range.durationUs as number) + 1_000 };
    expect(check.validate(project).ok).toBe(false);
  });

  it('still accepts a document whose entities it has already seen', () => {
    const check = validator();
    const project = currentProject();
    deepFreeze(project);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(check.validate(project).ok).toBe(true);
    }
  });

  it('keeps reporting the same diagnostic for a document it rejects', () => {
    const check = validator();
    const project = currentProject();
    ((project.items as JsonObject).item_opening as JsonObject).type = 'hologram';
    deepFreeze(project);
    const first = check.validate(project);
    const second = check.validate(project);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;
    expect(second.diagnostics[0]?.code).toBe(first.diagnostics[0]?.code);
    expect(second.diagnostics[0]?.path).toStrictEqual(first.diagnostics[0]?.path);
  });
});

describe('the bounds cache stays exact', () => {
  it('counts a shared frozen subtree once per appearance', () => {
    // Admission of an already-owned document deliberately permits repetition,
    // so a cached subtree has to contribute its whole total every time it is
    // reached. A cache that credited only the first appearance would let a
    // document of any size through by repeating one measured subtree.
    const block: JsonValue[] = [];
    for (let index = 0; index < 1_000; index += 1) block.push(index);
    const shared = deepFreeze(block) as unknown as JsonValue;

    const under: JsonValue[] = [];
    for (let index = 0; index < 200; index += 1) under.push(shared);
    expect(() => assertAdmittedProjectInput(under as unknown as JsonValue)).not.toThrow();

    // Past PROJECT_INPUT_MAX_NODES only if every repeat is counted.
    const over: JsonValue[] = [];
    for (let index = 0; index < 300; index += 1) over.push(shared);
    expect(() => assertAdmittedProjectInput(over as unknown as JsonValue)).toThrow(/JSON values/u);
  });

  it('rejects a measured subtree that no longer fits when placed deeper', () => {
    // Measured near the root, then buried. The cache records how deep the
    // subtree reaches, so the same object is refused where it would overflow.
    const leaf = deepFreeze({ a: { b: { c: { d: 1 } } } }) as unknown as JsonValue;
    expect(() => assertAdmittedProjectInput({ leaf } as unknown as JsonValue)).not.toThrow();

    let nested: JsonValue = leaf;
    for (let depth = 0; depth < PROJECT_INPUT_MAX_DEPTH; depth += 1) {
      nested = { down: nested } as unknown as JsonValue;
    }
    expect(() => assertAdmittedProjectInput(nested)).toThrow(/depth/u);
  });

  it('preserves cached child depth when measuring a frozen parent', () => {
    const leaf = deepFreeze({ a: { b: { c: 1 } } }) as unknown as JsonValue;
    expect(() => assertAdmittedProjectInput(leaf)).not.toThrow();
    const parent = deepFreeze({ leaf }) as unknown as JsonValue;
    expect(() => assertAdmittedProjectInput(parent)).not.toThrow();
    expect(() => assertAdmittedProjectInput(nest(parent, PROJECT_INPUT_MAX_DEPTH))).toThrow(
      /depth/u,
    );
  });

  it('accepts the same subtree again at a depth where it does fit', () => {
    const leaf = deepFreeze({ a: { b: 1 } }) as unknown as JsonValue;
    expect(() => assertAdmittedProjectInput(nest(leaf, 40))).not.toThrow();
    expect(() => assertAdmittedProjectInput(nest(leaf, 4))).not.toThrow();
    expect(() => assertAdmittedProjectInput(nest(leaf, 40))).not.toThrow();
  });

  function nest(value: JsonValue, levels: number): JsonValue {
    let result = value;
    for (let index = 0; index < levels; index += 1)
      result = { down: result } as unknown as JsonValue;
    return result;
  }

  it('agrees with a fresh walk on arbitrary frozen documents', () => {
    // The property the cache must preserve: a document is accepted exactly when
    // it would be without any memory of having seen its parts before.
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 5 }), fc.boolean(), (value, freeze) => {
        const candidate = freeze ? deepFreeze(value) : value;
        let firstThrew = false;
        try {
          assertAdmittedProjectInput(candidate);
        } catch {
          firstThrew = true;
        }
        let secondThrew = false;
        try {
          assertAdmittedProjectInput(candidate);
        } catch {
          secondThrew = true;
        }
        expect(secondThrew).toBe(firstThrew);
      }),
      { numRuns: 400 },
    );
  });

  it('still rejects a non-canonical number inside a subtree seen before', () => {
    const clean = { range: { startUs: 0 } };
    expect(() => assertAdmittedProjectInput(clean as unknown as JsonValue)).not.toThrow();
    // Same shape, never frozen, now holding a value a Project cannot store.
    const dirty = { range: { startUs: Number.NaN } };
    expect(() => assertAdmittedProjectInput(dirty as unknown as JsonValue)).toThrow();
  });
});
