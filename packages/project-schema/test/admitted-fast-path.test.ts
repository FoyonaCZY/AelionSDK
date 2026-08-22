import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelionsdk/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertAdmittedProjectInput,
  canonicalStringify,
  PROJECT_INPUT_MAX_ARRAY_LENGTH,
  PROJECT_INPUT_MAX_DEPTH,
  PROJECT_INPUT_MAX_NODES,
  PROJECT_INPUT_MAX_OBJECT_KEYS,
  PROJECT_INPUT_MAX_STRING_BYTES,
  ProjectInputAdmissionError,
  ProjectValidator,
  snapshotProjectInput,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

async function loadValidator(): Promise<ProjectValidator> {
  const [projectSchema, materialInstanceSchema] = await Promise.all([
    readJson('schemas/project/v1/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
  ]);
  return new ProjectValidator({ projectSchema, materialInstanceSchema });
}

function admissionCode(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectInputAdmissionError);
    return (error as ProjectInputAdmissionError).code;
  }
}

function nest(depth: number): unknown {
  let value: unknown = 0;
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

describe('assertAdmittedProjectInput', () => {
  it('accepts every value snapshotProjectInput accepts, and agrees on rejection', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 8 }), value => {
        let snapshot: unknown;
        try {
          snapshot = snapshotProjectInput(value);
        } catch {
          // Values the cloning pass rejects are out of scope: the fast path only
          // ever sees documents that already passed it.
          return;
        }
        expect(
          admissionCode(() => {
            assertAdmittedProjectInput(snapshot);
          }),
        ).toBeUndefined();
      }),
      { numRuns: 1_000, endOnFailure: true },
    );
  });

  it('counts UTF-8 bytes exactly like the cloning pass, including lone surrogates', () => {
    const encoder = new TextEncoder();
    // The fast path re-implements the byte budget without allocating an encoded
    // copy. If the two ever disagreed, a document could load and then be
    // rejected by its first edit, so pin them together at the exact threshold.
    // 'a' is 1 byte, 'é' 2, a lone surrogate 3 (TextEncoder emits U+FFFD), 😀 4.
    for (const unit of ['a', 'é', '\ud800', '😀']) {
      const unitBytes = encoder.encode(unit).byteLength;
      const fits = Math.floor(PROJECT_INPUT_MAX_STRING_BYTES / unitBytes);
      const atLimit = unit.repeat(fits);
      const overLimit = unit.repeat(fits + 1);
      expect(encoder.encode(atLimit).byteLength).toBeLessThanOrEqual(
        PROJECT_INPUT_MAX_STRING_BYTES,
      );
      expect(encoder.encode(overLimit).byteLength).toBeGreaterThan(PROJECT_INPUT_MAX_STRING_BYTES);

      expect(admissionCode(() => void snapshotProjectInput(atLimit))).toBeUndefined();
      expect(
        admissionCode(() => {
          assertAdmittedProjectInput(atLimit);
        }),
      ).toBeUndefined();

      expect(admissionCode(() => void snapshotProjectInput(overLimit))).toBe(
        'PROJECT_INPUT_LIMIT_EXCEEDED',
      );
      expect(
        admissionCode(() => {
          assertAdmittedProjectInput(overLimit);
        }),
      ).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');
    }
  });

  it('enforces the aggregate node budget, which also terminates a cycle', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      admissionCode(() => {
        assertAdmittedProjectInput(cyclic);
      }),
    ).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');

    const wide = Array.from({ length: PROJECT_INPUT_MAX_NODES + 2 }, (_unused, index) => index);
    expect(
      admissionCode(() => {
        assertAdmittedProjectInput(wide);
      }),
    ).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');
  });

  it('enforces depth, array length and object key limits', () => {
    expect(
      admissionCode(() => {
        assertAdmittedProjectInput(nest(PROJECT_INPUT_MAX_DEPTH - 1));
      }),
    ).toBeUndefined();
    expect(
      admissionCode(() => {
        assertAdmittedProjectInput(nest(PROJECT_INPUT_MAX_DEPTH + 2));
      }),
    ).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');
    expect(
      admissionCode(() => {
        assertAdmittedProjectInput([new Array<number>(PROJECT_INPUT_MAX_ARRAY_LENGTH + 1).fill(0)]);
      }),
    ).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');
    const keys: Record<string, number> = {};
    for (let index = 0; index <= PROJECT_INPUT_MAX_OBJECT_KEYS; index += 1) {
      keys[`k${index.toString()}`] = index;
    }
    expect(
      admissionCode(() => {
        assertAdmittedProjectInput(keys);
      }),
    ).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');
  });

  it('rejects non-canonical numbers and non-JSON values', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, Number.MAX_SAFE_INTEGER + 2]) {
      expect(
        admissionCode(() => {
          assertAdmittedProjectInput({ value });
        }),
      ).toBe('PROJECT_INPUT_INVALID');
    }
    for (const value of [undefined, () => 0, Symbol('s'), 1n]) {
      expect(
        admissionCode(() => {
          assertAdmittedProjectInput({ value });
        }),
      ).toBe('PROJECT_INPUT_INVALID');
    }
  });
});

describe('ProjectValidator.validateAdmitted', () => {
  it('accepts an admitted Project and returns the same canonical document', async () => {
    const validator = await loadValidator();
    const fixture = await readJson('examples/aelion-project-v1.example.json');
    const full = validator.validate(fixture);
    if (!full.ok) throw new Error(JSON.stringify(full.diagnostics, null, 2));

    const fast = validator.validateAdmitted(full.value.project);
    if (!fast.ok) throw new Error(JSON.stringify(fast.diagnostics, null, 2));
    expect(canonicalStringify(fast.value.project)).toBe(canonicalStringify(full.value.project));
  });

  it('reports the same schema and semantic diagnostics as the cloning path', async () => {
    const validator = await loadValidator();
    const fixture = await readJson('examples/aelion-project-v1.example.json');
    const admitted = validator.validate(fixture);
    if (!admitted.ok) throw new Error('fixture should be valid');

    const broken = JSON.parse(canonicalStringify(admitted.value.project)) as Record<
      string,
      unknown
    >;
    const items = broken.items as Record<string, Record<string, unknown>>;
    const target = items.item_video_a;
    if (target === undefined) throw new Error('fixture is missing item_video_a');
    target.trackId = 'track_does_not_exist';

    const slow = validator.validate(broken);
    const fast = validator.validateAdmitted(broken);
    expect(fast.ok).toBe(false);
    expect(slow.ok).toBe(false);
    expect(fast.diagnostics.map(entry => entry.code)).toStrictEqual(
      slow.diagnostics.map(entry => entry.code),
    );
  });

  it('still refuses a document that outgrew the admission budget', async () => {
    const validator = await loadValidator();
    const fixture = await readJson('examples/aelion-project-v1.example.json');
    const admitted = validator.validate(fixture);
    if (!admitted.ok) throw new Error('fixture should be valid');

    const oversized = JSON.parse(canonicalStringify(admitted.value.project)) as Record<
      string,
      unknown
    >;
    oversized.extensions = { bloat: nest(PROJECT_INPUT_MAX_DEPTH + 4) };
    const result = validator.validateAdmitted(oversized);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('PROJECT_INPUT_LIMIT_EXCEEDED');
  });
});
