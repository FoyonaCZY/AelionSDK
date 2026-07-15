import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelion/core';
import type { AelionProject } from '@aelion/project-schema';
import { ProjectValidator } from '@aelion/project-schema';
import { IncrementalRenderCompiler } from '@aelion/render-ir';
import { beforeAll, describe, expect, it } from 'vitest';

import { TransactionEngine } from '../src/index.js';

const root = new URL('../../../', import.meta.url);
let project: AelionProject;
let validate: (value: unknown) => { readonly ok: boolean; readonly diagnostics: readonly never[] };

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

beforeAll(async () => {
  const [projectSchema, materialSchema, fixture] = await Promise.all([
    readJson('schemas/project/v1/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
    readJson('examples/aelion-vertical-slice-30s.project.json'),
  ]);
  const validator = new ProjectValidator({
    projectSchema,
    materialInstanceSchema: materialSchema,
  });
  const result = validator.validate(fixture);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  project = result.value.project;
  validate = value => {
    const validation = validator.validate(value);
    return { ok: validation.ok, diagnostics: validation.diagnostics as readonly never[] };
  };
});

describe('30-second vertical-slice edit integration', () => {
  it('atomically edits an Item and Material and recompiles only their Render IR dependents', () => {
    const engine = new TransactionEngine(project, validate);
    const compiler = new IncrementalRenderCompiler();
    const first = compiler.compile(engine.getSnapshot(), 'seq_vertical', engine.revision);
    const commit = engine.edit({ baseRevision: 0n, label: 'Move clip and warm the look' }, edit => {
      edit.setField('items', 'item_opening', ['visual', 'opacity'], 0.8);
      edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.85);
    });
    const second = compiler.compile(commit.snapshot, 'seq_vertical', commit.revision, {
      affectedEntityIds: commit.changeSet.affectedEntityIds,
      affectedRanges: commit.changeSet.affectedRanges,
    });

    expect(first.stats.compiledClips).toBe(3);
    expect(commit.changeSet.affectedEntityIds).toEqual(['item_opening', 'mat_warm']);
    expect(commit.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_vertical', startUs: 0, durationUs: 16_000_000 },
    ]);
    expect(second.stats).toMatchObject({
      compiledClips: 1,
      reusedClips: 2,
      compiledTransitions: 0,
      reusedTransitions: 1,
    });
    expect(second.ir.revision).toBe(1n);
  });
});
