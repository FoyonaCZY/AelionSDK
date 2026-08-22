import { readFile } from 'node:fs/promises';

import { AelionError, type JsonObject } from '@aelionsdk/core';
import { ProjectValidator, type AelionProject } from '@aelionsdk/project-schema';
import { afterEach, describe, expect, it } from 'vitest';

import { TransactionEngine, type AtomicOperation } from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

async function loadEngine(): Promise<TransactionEngine> {
  const [projectSchema, materialInstanceSchema, fixture] = await Promise.all([
    readJson('schemas/project/v1/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
    readJson('examples/aelion-project-v1.example.json'),
  ]);
  const validator = new ProjectValidator({ projectSchema, materialInstanceSchema });
  const initial = validator.validate(fixture);
  if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics, null, 2));
  const project: AelionProject = initial.value.project;
  // Mirrors AelionSession: the engine only ever sees admitted candidates.
  return new TransactionEngine(project, value => {
    const result = validator.validateAdmitted(value);
    return { ok: result.ok, diagnostics: result.diagnostics };
  });
}

function diagnosticCodes(run: () => void): readonly string[] {
  try {
    run();
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(AelionError);
    return (error as AelionError).diagnostics.map(entry => entry.code);
  }
}

describe('operation admission', () => {
  afterEach(() => {
    // Fail loudly if any case actually managed to pollute the prototype.
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    Reflect.deleteProperty(Object.prototype, 'polluted');
  });

  it('commits a normal interactive edit', async () => {
    const engine = await loadEngine();
    const commit = engine.edit({ label: 'drag' }, transaction => {
      transaction.setField('items', 'item_video_a', ['visual', 'opacity'], 0.5);
    });
    expect(commit.revision).toBe(1n);
    const item = engine.getSnapshot().items.item_video_a as unknown as {
      visual: { opacity: number };
    };
    expect(item.visual.opacity).toBe(0.5);
  });

  it('rejects a cyclic field value with an entity-scoped diagnostic', async () => {
    const engine = await loadEngine();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const codes = diagnosticCodes(() => {
      engine.edit({ label: 'cycle' }, transaction => {
        transaction.setField('items', 'item_video_a', ['visual'], cyclic as never);
      });
    });
    expect(codes).toStrictEqual(['PROJECT_INPUT_INVALID']);
    expect(engine.revision).toBe(0n);
  });

  it('rejects non-canonical numbers and non-JSON payloads', async () => {
    const engine = await loadEngine();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(
        diagnosticCodes(() => {
          engine.edit({ label: 'bad number' }, transaction => {
            transaction.setField('items', 'item_video_a', ['visual', 'opacity'], value);
          });
        }),
      ).toStrictEqual(['PROJECT_INPUT_INVALID']);
    }
    expect(
      diagnosticCodes(() => {
        engine.edit({ label: 'function' }, transaction => {
          transaction.setField('items', 'item_video_a', ['visual', 'opacity'], (() => 0) as never);
        });
      }),
    ).toStrictEqual(['PROJECT_INPUT_INVALID']);
    expect(engine.revision).toBe(0n);
  });

  it('rejects a value carrying accessor properties instead of invoking them', async () => {
    const engine = await loadEngine();
    let invoked = false;
    const hostile = Object.defineProperty({}, 'x', {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    expect(
      diagnosticCodes(() => {
        engine.edit({ label: 'accessor' }, transaction => {
          transaction.setField('items', 'item_video_a', ['visual'], hostile as never);
        });
      }),
    ).toStrictEqual(['PROJECT_INPUT_INVALID']);
    expect(invoked).toBe(false);
  });

  it('rejects an unknown collection instead of reaching through the prototype chain', async () => {
    const engine = await loadEngine();
    for (const collection of ['__proto__', 'constructor', 'nope']) {
      expect(
        diagnosticCodes(() => {
          engine.edit({ label: 'collection' }, transaction => {
            transaction.createEntity(collection as never, 'polluted', { id: 'polluted' });
          });
        }),
      ).toStrictEqual(['TRANSACTION_COLLECTION_INVALID']);
    }
    expect(engine.revision).toBe(0n);
  });

  it('rejects __proto__ as an entity id, field path segment or list anchor', async () => {
    const engine = await loadEngine();
    expect(
      diagnosticCodes(() => {
        engine.edit({ label: 'id' }, transaction => {
          transaction.createEntity('markers', '__proto__', { id: '__proto__' });
        });
      }),
    ).toStrictEqual(['TRANSACTION_KEY_INVALID']);
    expect(
      diagnosticCodes(() => {
        engine.edit({ label: 'path' }, transaction => {
          transaction.setField('items', 'item_video_a', ['__proto__', 'polluted'], 1);
        });
      }),
    ).toStrictEqual(['TRANSACTION_KEY_INVALID']);
    expect(
      diagnosticCodes(() => {
        engine.edit({ label: 'anchor' }, transaction => {
          transaction.listInsert('tracks', 'track_video_main', ['itemIds'], '__proto__');
        });
      }),
    ).toStrictEqual(['TRANSACTION_KEY_INVALID']);
    expect(engine.revision).toBe(0n);
  });

  it('takes ownership of the payload so later caller mutation cannot leak in', async () => {
    const engine = await loadEngine();
    const payload = { x: 1, y: 2 };
    engine.edit({ label: 'own' }, transaction => {
      transaction.setField('items', 'item_video_a', ['visual', 'transform', 'positionPx'], payload);
    });
    payload.x = 999;
    const item = engine.getSnapshot().items.item_video_a as unknown as {
      visual: { transform: { positionPx: { x: number } } };
    };
    expect(item.visual.transform.positionPx.x).toBe(1);
  });

  it('applies the same admission to replayed change sets', async () => {
    const engine = await loadEngine();
    const commit = engine.edit({ label: 'seed' }, transaction => {
      transaction.setField('items', 'item_video_a', ['visual', 'opacity'], 0.25);
    });
    const hostile = {
      ...commit.changeSet,
      baseRevision: engine.revision,
      operations: [
        {
          op: 'setField',
          collection: '__proto__',
          id: 'polluted',
          path: ['polluted'],
          value: 1,
        } as unknown as AtomicOperation,
      ],
    };
    expect(diagnosticCodes(() => void engine.applyChangeSet(hostile))).toStrictEqual([
      'TRANSACTION_COLLECTION_INVALID',
    ]);
  });
});
