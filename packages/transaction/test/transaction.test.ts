import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelion/core';
import type { AelionProject } from '@aelion/project-schema';
import { canonicalHash, ProjectValidator } from '@aelion/project-schema';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applyOperations,
  TRANSACTION_MAX_OPERATIONS,
  TransactionEngine,
  type AtomicOperation,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

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
    return {
      ok: result.ok,
      diagnostics: result.diagnostics as readonly never[],
    };
  };
});

describe('TransactionEngine', () => {
  it('rejects an oversized operation batch before cloning or publishing it', () => {
    const engine = new TransactionEngine(project, validate);
    const operation: AtomicOperation = {
      op: 'setField',
      collection: 'items',
      id: 'item_title',
      path: ['name'],
      value: 'bounded',
    };
    let failure: unknown;
    try {
      engine.edit({}, transaction => {
        transaction.appendOperations(new Array(TRANSACTION_MAX_OPERATIONS + 1).fill(operation));
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'TRANSACTION_OPERATION_LIMIT_EXCEEDED' })],
    });
    expect(engine.revision).toBe(0n);
  });

  it('atomically commits operations and emits one event', () => {
    const engine = new TransactionEngine(project, validate);
    const events: unknown[] = [];
    engine.subscribe(commit => events.push(commit));

    const commit = engine.edit({ label: 'Move and rename', baseRevision: 0n }, transaction => {
      transaction.setField('items', 'item_title', ['name'], 'Updated title');
      transaction.setField('items', 'item_title', ['range', 'startUs'], 1_500_000);
    });

    expect(commit.revision).toBe(1n);
    expect(events).toHaveLength(1);
    expect(engine.getSnapshot().items.item_title?.name).toBe('Updated title');
    expect(engine.getSnapshot().items.item_title?.range.startUs).toBe(1_500_000);
    expect(commit.changeSet.affectedEntityIds).toEqual(['item_title']);
    expect(commit.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 900_000, durationUs: 3_600_000 },
    ]);
  });

  it('rolls back the entire transaction when an operation fails', async () => {
    const engine = new TransactionEngine(project, validate);
    const beforeHash = await canonicalHash(engine.getSnapshot());
    const beforeRevision = engine.revision;
    let events = 0;
    engine.subscribe(() => {
      events += 1;
    });

    expect(() =>
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['name'], 'Must not persist');
        transaction.setField('items', 'missing', ['name'], 'Failure');
      }),
    ).toThrow();

    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);
    expect(engine.revision).toBe(beforeRevision);
    expect(events).toBe(0);
  });

  it('rejects a semantically invalid draft without exposing it', async () => {
    const engine = new TransactionEngine(project, validate);
    const beforeHash = await canonicalHash(engine.getSnapshot());

    expect(() =>
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['trackId'], 'track_missing');
      }),
    ).toThrow();

    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);
    expect(engine.revision).toBe(0n);
  });

  it('rejects stale revisions', () => {
    const engine = new TransactionEngine(project, validate);
    engine.edit({ baseRevision: 0n }, transaction => {
      transaction.setField('items', 'item_title', ['name'], 'Revision one');
    });

    expect(() =>
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['name'], 'Stale');
      }),
    ).toThrow(/Expected revision 0/u);
  });

  it('prepares derived state before publishing a Project commit', async () => {
    let failPreparation = true;
    let publishedRevision: bigint | undefined;
    const engine = new TransactionEngine(project, validate, {
      prepareCommit: commit => {
        if (failPreparation) throw new Error('prepare failed');
        return {
          publish: () => {
            publishedRevision = commit.revision;
          },
        };
      },
    });
    const before = engine.getSnapshot();
    const beforeHash = await canonicalHash(before);
    let events = 0;
    engine.subscribe(() => {
      events += 1;
    });

    expect(() =>
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['name'], 'Prepared title');
      }),
    ).toThrow('prepare failed');
    expect(engine.revision).toBe(0n);
    expect(engine.getSnapshot()).toBe(before);
    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);
    expect(publishedRevision).toBeUndefined();
    expect(events).toBe(0);

    failPreparation = false;
    const commit = engine.edit({ baseRevision: 0n }, transaction => {
      transaction.setField('items', 'item_title', ['name'], 'Prepared title');
    });
    expect(commit.revision).toBe(1n);
    expect(publishedRevision).toBe(1n);
    expect(events).toBe(1);
  });

  it('rejects synchronous nested edits without committing either draft', async () => {
    let engine!: TransactionEngine;
    let nestedError: unknown;
    engine = new TransactionEngine(project, candidate => {
      const result = validate(candidate);
      try {
        engine.edit({ baseRevision: engine.revision }, transaction => {
          transaction.setField('items', 'item_title', ['name'], 'Nested');
        });
      } catch (error) {
        nestedError = error;
      }
      return result;
    });
    const before = engine.getSnapshot();
    const beforeHash = await canonicalHash(before);

    expect(() =>
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['name'], 'Outer');
      }),
    ).toThrow(/nested transaction/u);
    expect(nestedError).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'TRANSACTION_REENTRANT' })],
    });
    expect(engine.revision).toBe(0n);
    expect(engine.getSnapshot()).toBe(before);
    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);

    engine = new TransactionEngine(project, validate);
    expect(
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['name'], 'After guard');
      }).revision,
    ).toBe(1n);
  });

  it('isolates post-commit observers and snapshots listener membership', () => {
    const engine = new TransactionEngine(project, validate);
    const observed: string[] = [];
    engine.subscribe(() => {
      observed.push('first');
      engine.subscribe(() => observed.push('late'));
      throw new Error('observer failed');
    });
    engine.subscribe(() => observed.push('second'));

    expect(() =>
      engine.edit({ baseRevision: 0n }, transaction => {
        transaction.setField('items', 'item_title', ['name'], 'Observed');
      }),
    ).not.toThrow();
    expect(engine.revision).toBe(1n);
    expect(observed).toEqual(['first', 'second']);
  });

  it('restores the canonical hash by applying generated inverse operations', async () => {
    const engine = new TransactionEngine(project, validate);
    const before = engine.getSnapshot();
    const beforeHash = await canonicalHash(before);
    const commit = engine.edit({ baseRevision: 0n }, transaction => {
      transaction.setField('items', 'item_title', ['name'], 'Changed');
      transaction.listMove(
        'tracks',
        'track_video_main',
        ['itemIds'],
        'item_video_b',
        'item_video_a',
      );
    });

    const restored = structuredClone(commit.snapshot);
    applyOperations(restored, commit.inverse);
    expect(await canonicalHash(restored)).toBe(beforeHash);
  });
});
