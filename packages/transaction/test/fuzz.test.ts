import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelionsdk/core';
import { canonicalHash, ProjectValidator, type AelionProject } from '@aelionsdk/project-schema';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import { TransactionEngine, TransactionHistory } from '../src/index.js';

const root = new URL('../../../', import.meta.url);
let project: AelionProject;
let validate: (value: unknown) => { readonly ok: boolean; readonly diagnostics: readonly never[] };

beforeAll(async () => {
  const [projectSchema, materialInstanceSchema, fixture] = await Promise.all([
    readJson('schemas/project/v1/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
    readJson('examples/aelion-project-v1.example.json'),
  ]);
  const validator = new ProjectValidator({ projectSchema, materialInstanceSchema });
  const initial = validator.validate(fixture);
  if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
  project = initial.value.project;
  validate = value => {
    const result = validator.validate(value);
    return { ok: result.ok, diagnostics: result.diagnostics as readonly never[] };
  };
});

interface Operation {
  readonly kind: 'move-title' | 'toggle-solo';
  readonly value: number | boolean;
}

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

describe('transaction sequence round-trip', () => {
  it('undoes every random edit back to the initial state, then redoes to the final state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant('move-title' as const),
              value: fc.integer({ min: 0, max: 4_000_000 }),
            }),
            fc.record({
              kind: fc.constant('toggle-solo' as const),
              value: fc.boolean(),
            }),
          ),
          { maxLength: 8 },
        ),
        async (operations: readonly Operation[]) => {
          const engine = new TransactionEngine(project, validate);
          const history = new TransactionHistory(engine);
          const initialHash = await canonicalHash(engine.getSnapshot());

          for (const operation of operations) {
            history.edit({ label: 'fuzz' }, transaction => {
              if (operation.kind === 'move-title') {
                transaction.setField(
                  'items',
                  'item_title',
                  ['range', 'startUs'],
                  operation.value as number,
                );
              } else {
                transaction.setField(
                  'tracks',
                  'track_music',
                  ['audio', 'solo'],
                  operation.value as boolean,
                );
              }
            });
          }
          const finalHash = await canonicalHash(engine.getSnapshot());

          for (let index = 0; index < operations.length; index += 1) {
            history.undo();
          }
          expect(await canonicalHash(engine.getSnapshot())).toBe(initialHash);

          for (let index = 0; index < operations.length; index += 1) {
            history.redo();
          }
          expect(await canonicalHash(engine.getSnapshot())).toBe(finalHash);
        },
      ),
      { numRuns: 100 },
    );
  });
});
