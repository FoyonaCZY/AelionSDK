import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelionsdk/core';
import type { AelionProject } from '@aelionsdk/project-schema';
import { IncrementalRenderCompiler } from '@aelionsdk/render-ir';
import { speculateProjectChange, type TransactionBuilder } from '@aelionsdk/transaction';
import { describe, expect, it } from 'vitest';

import { Aelion } from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

async function session() {
  const [project, projectSchema, materialInstanceSchema] = await Promise.all([
    json('examples/aelion-vertical-slice-30s.project.json'),
    json('schemas/project/v1/project.schema.json'),
    json('schemas/material/v1/instance.schema.json'),
  ]);
  const value = await Aelion.createSession({
    schemas: { project: projectSchema, materialInstance: materialInstanceSchema },
    media: {
      frameAt: () => Promise.reject(new Error('no decoder in this environment')),
      pcmRange: () => Promise.reject(new Error('no decoder in this environment')),
    },
  });
  await value.loadProject(project);
  return value;
}

describe('speculative preview', () => {
  it('leaves the Project, its revision and its Render IR untouched', async () => {
    const value = await session();
    try {
      const beforeRevision = value.revision;
      const beforeSnapshot = value.getSnapshot();
      const changes: string[] = [];
      value.subscribe('project-changed', event => changes.push(event.commit.changeSet.id));

      // The render itself cannot succeed without a decoder; what matters is
      // that asking for it changed nothing.
      await value.preview
        .renderFrame({
          timeUs: 1_000_000,
          overlay: transaction => {
            transaction.setField('items', 'item_opening', ['range', 'startUs'], 9_000_000);
          },
        })
        .catch(() => undefined);

      expect(value.revision).toBe(beforeRevision);
      expect(changes).toEqual([]);
      const after = value.getSnapshot();
      expect(after.project?.items.item_opening?.range.startUs).toBe(
        beforeSnapshot.project?.items.item_opening?.range.startUs,
      );
      expect(after.renderIr).toBe(beforeSnapshot.renderIr);
    } finally {
      await value.dispose();
    }
  });

  it('leaves no history entry, so an abandoned drag has nothing to undo', async () => {
    const value = await session();
    try {
      expect(value.transaction.canUndo).toBe(false);
      await value.preview
        .renderFrame({
          timeUs: 0,
          overlay: transaction => {
            transaction.setField('items', 'item_opening', ['range', 'startUs'], 3_000_000);
          },
        })
        .catch(() => undefined);
      expect(value.transaction.canUndo).toBe(false);
    } finally {
      await value.dispose();
    }
  });

  it('does not disturb the committed compiler when speculation is repeated', async () => {
    const value = await session();
    try {
      const before = value.getSnapshot().renderIr;
      for (let index = 0; index < 5; index += 1) {
        await value.preview
          .renderFrame({
            timeUs: 0,
            overlay: transaction => {
              transaction.setField(
                'items',
                'item_opening',
                ['range', 'startUs'],
                1_000_000 * (index + 1),
              );
            },
          })
          .catch(() => undefined);
      }
      expect(value.getSnapshot().renderIr).toBe(before);
      expect(value.revision).toBe(0n);
    } finally {
      await value.dispose();
    }
  });

  it('still commits normally afterwards', async () => {
    const value = await session();
    try {
      await value.preview
        .renderFrame({
          timeUs: 0,
          overlay: transaction => {
            transaction.setField('items', 'item_opening', ['range', 'startUs'], 5_000_000);
          },
        })
        .catch(() => undefined);
      const commit = value.transaction.edit(
        transaction => {
          transaction.setField('items', 'item_opening', ['range', 'startUs'], 5_000_000);
        },
        { label: 'Move' },
      );
      expect(commit.revision).toBe(1n);
      expect(value.getSnapshot().project?.items.item_opening?.range.startUs).toBe(5_000_000);
    } finally {
      await value.dispose();
    }
  });
});

describe('speculating on a forked compiler', () => {
  /**
   * Pins why the Session declares the previous speculation's ids as well.
   *
   * A fork's baseline advances to whatever it last compiled, but every
   * speculation restarts from the committed Project. So between two pointer
   * moves the clips that changed are the ones this move touches *and* the ones
   * the last move touched, which have to travel back. Naming only the current
   * ones leaves the previous move's clip reused where the pointer already left
   * it, and the preview freezes a clip in mid-drag.
   */
  it('needs the union of two consecutive speculations to keep the older clip honest', async () => {
    const project = (await json(
      'examples/aelion-vertical-slice-30s.project.json',
    )) as AelionProject;
    const committed = new IncrementalRenderCompiler();
    committed.compile(project, 'seq_vertical', 0n);

    const move = (id: string, startUs: number) => (transaction: TransactionBuilder) => {
      transaction.setField('items', id, ['range', 'startUs'], startUs);
    };
    const startOf = (ir: ReturnType<typeof committed.compile>['ir'], id: string): number =>
      ir.tracks.flatMap(track => track.clips).find(clip => clip.id === id)?.range.startUs ?? -1;

    const first = speculateProjectChange(project, move('item_opening', 5_000_000));
    const second = speculateProjectChange(project, move('item_closing', 20_000_000));

    const honest = committed.fork();
    honest.compile(first.project as AelionProject, 'seq_vertical', 0n, {
      affectedEntityIds: first.affectedEntityIds,
    });
    const union = honest.compile(second.project as AelionProject, 'seq_vertical', 0n, {
      affectedEntityIds: [...first.affectedEntityIds, ...second.affectedEntityIds],
    });
    expect(startOf(union.ir, 'item_opening')).toBe(0);
    expect(startOf(union.ir, 'item_closing')).toBe(20_000_000);

    const stale = committed.fork();
    stale.compile(first.project as AelionProject, 'seq_vertical', 0n, {
      affectedEntityIds: first.affectedEntityIds,
    });
    const narrow = stale.compile(second.project as AelionProject, 'seq_vertical', 0n, {
      affectedEntityIds: second.affectedEntityIds,
    });
    // The failure the union exists to prevent: item_opening is still where the
    // abandoned first speculation put it.
    expect(startOf(narrow.ir, 'item_opening')).toBe(5_000_000);
  });
});

describe('player observation channels', () => {
  it('accepts many time listeners while frame ownership stays exclusive', async () => {
    const value = await session();
    try {
      const first = value.player.subscribeTime(() => undefined);
      const second = value.player.subscribeTime(() => undefined);
      expect(typeof first).toBe('function');
      expect(typeof second).toBe('function');

      const owner = value.player.subscribe(() => undefined);
      expect(() => value.player.subscribe(() => undefined)).toThrow(/one frame owner/u);
      owner();
      // Released, so another consumer may take ownership.
      value.player.subscribe(() => undefined)();
      first();
      second();
    } finally {
      await value.dispose();
    }
  });

  it('reports the playhead to a time listener when the transport changes state', async () => {
    const value = await session();
    try {
      const seen: { timeUs: number; state: string }[] = [];
      const unsubscribe = value.player.subscribeTime(time => {
        seen.push({ timeUs: time.timeUs, state: time.state });
      });
      await value.player.pause();
      unsubscribe();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.at(-1)?.timeUs).toBe(0);
    } finally {
      await value.dispose();
    }
  });

  it('exposes reset on the public Player surface, returning it to idle', async () => {
    const value = await session();
    try {
      await value.player.reset();
      expect(value.player.state).toBe('idle');
      expect(value.player.currentTimeUs).toBe(0);
    } finally {
      await value.dispose();
    }
  });

  it('does not wake a paused transport when an edit lands', async () => {
    const value = await session();
    try {
      await value.player.pause();
      const state = value.player.state;
      value.transaction.edit(
        transaction => {
          transaction.setField('items', 'item_opening', ['range', 'startUs'], 2_000_000);
        },
        { label: 'Move' },
      );
      expect(value.player.state).toBe(state);
      expect(value.player.getStats().resources.audio.mode).toBe('none');
    } finally {
      await value.dispose();
    }
  });
});
