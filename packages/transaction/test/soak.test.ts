import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelionsdk/core';
import {
  canonicalHash,
  canonicalStringify,
  ProjectValidator,
  type AelionProject,
} from '@aelionsdk/project-schema';
import { describe, expect, it } from 'vitest';

import { TransactionEngine, TransactionHistory } from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

describe('long-session restart recovery', () => {
  it('round-trips every edit checkpoint through canonical persistence without drift', async () => {
    const [projectSchema, materialInstanceSchema, fixture] = await Promise.all([
      readJson('schemas/project/v1/project.schema.json'),
      readJson('schemas/material/v1/instance.schema.json'),
      readJson('examples/aelion-project-v1.example.json'),
    ]);
    const validator = new ProjectValidator({ projectSchema, materialInstanceSchema });
    const initial = validator.validate(fixture);
    if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
    const project: AelionProject = initial.value.project;
    const validate = (value: unknown) => {
      const result = validator.validate(value);
      return { ok: result.ok, diagnostics: result.diagnostics as readonly never[] };
    };

    const engine = new TransactionEngine(project, validate);
    // Bounded histories trim undo entries; the soak verifies the whole session
    // is replayable, so raise the bound above the iteration count.
    const history = new TransactionHistory(engine, { maxEntries: 2_048 });

    // A bounded long-session simulation: apply edits, and after every edit
    // persist the canonical snapshot, discard it, reload through admission and
    // schema validation (a "restart"), and require the restored hash to match.
    const ITERATIONS = 400;
    for (let step = 1; step <= ITERATIONS; step += 1) {
      const startUs = (step * 1_337) % 4_000_000;
      history.edit({ label: `edit-${step}` }, transaction => {
        transaction.setField('items', 'item_title', ['range', 'startUs'], startUs);
      });

      const persisted = canonicalStringify(engine.getSnapshot());
      const restored = JSON.parse(persisted) as unknown;
      const admitted = validator.validate(restored);
      if (!admitted.ok) throw new Error(JSON.stringify(admitted.diagnostics, null, 2));
      const restoredHash = await canonicalHash(admitted.value.project);
      expect(restoredHash).toBe(await canonicalHash(engine.getSnapshot()));
    }

    // Undo the full session back to the origin, then redo it back to the end.
    const finalHash = await canonicalHash(engine.getSnapshot());
    for (let step = 0; step < ITERATIONS; step += 1) history.undo();
    expect(await canonicalHash(engine.getSnapshot())).toBe(await canonicalHash(project));
    for (let step = 0; step < ITERATIONS; step += 1) history.redo();
    expect(await canonicalHash(engine.getSnapshot())).toBe(finalHash);
  });
});
