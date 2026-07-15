import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelion/core';
import type { AelionProject, ItemEntity } from '@aelion/project-schema';
import { canonicalHash, ProjectValidator } from '@aelion/project-schema';
import { beforeAll, describe, expect, it } from 'vitest';

import { EditingCommands, TransactionEngine, TransactionHistory } from '../src/index.js';

const root = new URL('../../../', import.meta.url);
let project: AelionProject;
let validate: (value: unknown) => { readonly ok: boolean; readonly diagnostics: readonly never[] };

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

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

function create(): {
  readonly engine: TransactionEngine;
  readonly commands: EditingCommands;
} {
  const engine = new TransactionEngine(project, validate);
  return { engine, commands: new EditingCommands(engine) };
}

function videoItem(id: string, trackId = 'track_video_main'): ItemEntity {
  const item = structuredClone(project.items.item_video_a);
  if (item === undefined) throw new Error('Fixture Item is missing');
  item.id = id;
  item.trackId = trackId;
  item.materialInstanceIds = [];
  Reflect.deleteProperty(item, 'linkGroupId');
  return item;
}

describe('EditingCommands', () => {
  it('inserts, moves across Tracks and removes an Item atomically', async () => {
    const { engine, commands } = create();
    const beforeHash = await canonicalHash(engine.getSnapshot());
    const inserted = videoItem('item_inserted');
    const insert = commands.insertItem({
      item: inserted,
      beforeItemId: 'item_video_b',
      baseRevision: 0n,
    });

    expect(engine.getSnapshot().tracks.track_video_main?.itemIds).toEqual([
      'item_video_a',
      'item_inserted',
      'item_video_b',
    ]);
    expect(insert.changeSet.affectedEntityIds).toEqual(['item_inserted', 'track_video_main']);
    expect(insert.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 0, durationUs: 5_200_000 },
    ]);

    const moved = commands.moveItem({
      itemId: inserted.id,
      toTrackId: 'track_title',
      startUs: 6_000_000,
      beforeItemId: 'item_title',
      baseRevision: 1n,
    });
    expect(moved.snapshot.items.item_inserted?.trackId).toBe('track_title');
    expect(moved.snapshot.items.item_inserted?.range.startUs).toBe(6_000_000);
    expect(moved.snapshot.tracks.track_video_main?.itemIds).not.toContain(inserted.id);
    expect(moved.snapshot.tracks.track_title?.itemIds[0]).toBe(inserted.id);
    expect(moved.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 0, durationUs: 5_200_000 },
      { sequenceId: 'seq_main', startUs: 6_000_000, durationUs: 5_200_000 },
    ]);

    const removed = commands.removeItem({ itemId: inserted.id, baseRevision: 2n });
    expect(removed.snapshot.items.item_inserted).toBeUndefined();
    expect(removed.snapshot.tracks.track_title?.itemIds).not.toContain(inserted.id);

    const restored = structuredClone(removed.snapshot);
    // All three semantic commands remain individually invertible.
    const { applyOperations } = await import('../src/index.js');
    applyOperations(restored, removed.inverse);
    applyOperations(restored, moved.inverse);
    applyOperations(restored, insert.inverse);
    expect(await canonicalHash(restored)).toBe(beforeHash);
  });

  it('trims linear forward and reverse media while preserving source mapping', () => {
    const { engine, commands } = create();
    engine.edit({ baseRevision: 0n }, transaction => {
      transaction.listRemove('sequences', 'seq_main', ['transitionIds'], 'transition_ab');
      transaction.deleteEntity('transitions', 'transition_ab');
      transaction.deleteEntity('materialInstances', 'mat_cross_dissolve');
      transaction.removeField('items', 'item_video_b', ['linkGroupId']);
      transaction.removeField('items', 'item_audio_b', ['linkGroupId']);
      transaction.deleteEntity('linkGroups', 'link_av_b');
    });
    const forward = commands.trimItem({
      itemId: 'item_video_b',
      edge: 'start',
      toUs: 5_800_000,
      baseRevision: 1n,
    });
    expect(forward.snapshot.items.item_video_b).toMatchObject({
      range: { startUs: 5_800_000, durationUs: 4_200_000 },
      source: { sourceRange: { startUs: 1_000_000, durationUs: 4_200_000 } },
    });
    expect(forward.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 4_800_000, durationUs: 5_200_000 },
    ]);

    engine.edit({ baseRevision: 2n }, transaction => {
      transaction.setField('items', 'item_video_b', ['source', 'timeMapping', 'reverse'], true);
    });
    const reverse = commands.trimItem({
      itemId: 'item_video_b',
      edge: 'end',
      toUs: 9_000_000,
      baseRevision: 3n,
    });
    expect(reverse.snapshot.items.item_video_b).toMatchObject({
      range: { startUs: 5_800_000, durationUs: 3_200_000 },
      source: { sourceRange: { startUs: 2_000_000, durationUs: 3_200_000 } },
    });
  });

  it('splits an unowned media Item, preserves mapping and retargets its outgoing Transition', () => {
    const { engine, commands } = create();
    engine.edit({ baseRevision: 0n }, transaction => {
      transaction.setField('items', 'item_video_a', ['materialInstanceIds'], []);
      transaction.deleteEntity('materialInstances', 'mat_warm_film');
      transaction.removeField('items', 'item_video_a', ['linkGroupId']);
      transaction.removeField('items', 'item_audio_a', ['linkGroupId']);
      transaction.deleteEntity('linkGroups', 'link_av_a');
    });
    const result = commands.splitItem({
      itemId: 'item_video_a',
      rightItemId: 'item_video_a_right',
      atUs: 2_000_000,
      baseRevision: 1n,
    });

    expect(result.commit.snapshot.items.item_video_a).toMatchObject({
      range: { startUs: 0, durationUs: 2_000_000 },
      source: { sourceRange: { startUs: 1_000_000, durationUs: 2_000_000 } },
    });
    expect(result.commit.snapshot.items.item_video_a_right).toMatchObject({
      id: 'item_video_a_right',
      range: { startUs: 2_000_000, durationUs: 3_200_000 },
      source: { sourceRange: { startUs: 3_000_000, durationUs: 3_200_000 } },
    });
    expect(result.commit.snapshot.tracks.track_video_main?.itemIds).toEqual([
      'item_video_a',
      'item_video_a_right',
      'item_video_b',
    ]);
    expect(result.commit.snapshot.transitions.transition_ab?.fromItemId).toBe('item_video_a_right');
    expect(result.commit.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 0, durationUs: 5_200_000 },
    ]);
  });

  it('leaves revision and snapshot unchanged when a semantic command is rejected', async () => {
    const { engine, commands } = create();
    const beforeHash = await canonicalHash(engine.getSnapshot());
    expect(() =>
      commands.moveItem({
        itemId: 'item_video_a',
        toTrackId: 'track_title',
        baseRevision: 0n,
      }),
    ).toThrow(/linked/u);
    expect(engine.revision).toBe(0n);
    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);

    const invalid = structuredClone(project.items.item_title);
    if (invalid === undefined) throw new Error('Fixture Item is missing');
    Reflect.set(invalid.range, 'durationUs', 0);
    expect(() => commands.replaceItem({ itemId: invalid.id, replacement: invalid })).toThrow();
    expect(engine.revision).toBe(0n);
    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);
  });

  it('removes owned Transition, Material, Marker and degenerate LinkGroup without dangling refs', () => {
    const { engine, commands } = create();
    engine.edit({ baseRevision: 0n }, transaction => {
      transaction.createEntity('markers', 'marker_item_a', {
        id: 'marker_item_a',
        owner: { type: 'item', id: 'item_video_a' },
        timeUs: 1_000,
        durationUs: 1,
      });
      transaction.setField('items', 'item_video_a', ['markerIds'], ['marker_item_a']);
    });
    const commit = commands.removeItem({ itemId: 'item_video_a', baseRevision: 1n });

    expect(commit.snapshot.items.item_video_a).toBeUndefined();
    expect(commit.snapshot.transitions.transition_ab).toBeUndefined();
    expect(commit.snapshot.materialInstances.mat_cross_dissolve).toBeUndefined();
    expect(commit.snapshot.sequences.seq_main?.transitionIds).toEqual([]);
    expect(commit.snapshot.markers.marker_item_a).toBeUndefined();
    expect(commit.snapshot.linkGroups.link_av_a).toBeUndefined();
    expect(commit.snapshot.items.item_audio_a?.linkGroupId).toBeUndefined();
  });

  it('replaces content while preserving topology and offers Track convenience commands', () => {
    const { commands } = create();
    const replacement = structuredClone(project.items.item_title);
    if (replacement === undefined) throw new Error('Fixture Item is missing');
    replacement.name = 'Replacement title';
    const replaced = commands.replaceItem({ itemId: replacement.id, replacement });
    expect(replaced.snapshot.items.item_title?.name).toBe('Replacement title');

    commands.setTrackLocked({ trackId: 'track_title', value: true, baseRevision: 1n });
    expect(() =>
      commands.moveItem({ itemId: 'item_title', startUs: 2_000_000, baseRevision: 2n }),
    ).toThrow(/locked/u);
    commands.setTrackLocked({ trackId: 'track_title', value: false, baseRevision: 2n });
    commands.setTrackEnabled({ trackId: 'track_title', value: false, baseRevision: 3n });
    commands.setTrackMuted({ trackId: 'track_music', value: true, baseRevision: 4n });
    const reordered = commands.reorderTrack({
      sequenceId: 'seq_main',
      trackId: 'track_title',
      beforeTrackId: 'track_video_main',
      baseRevision: 5n,
    });
    expect(reordered.snapshot.tracks.track_title).toMatchObject({
      enabled: false,
      locked: false,
    });
    expect(reordered.snapshot.tracks.track_music?.audio).toMatchObject({ muted: true });
    expect(reordered.snapshot.sequences.seq_main?.trackIds[0]).toBe('track_title');
  });
});

describe('TransactionHistory', () => {
  it('undoes/redoes semantic commits through new validated revisions', async () => {
    const engine = new TransactionEngine(project, validate);
    const history = new TransactionHistory(engine, { maxEntries: 2 });
    const commands = new EditingCommands(history);
    const beforeHash = await canonicalHash(engine.getSnapshot());

    commands.moveItem({ itemId: 'item_title', startUs: 1_000_000, label: 'Offset title' });
    commands.setTrackMuted({ trackId: 'track_music', value: true, label: 'Mute music' });
    expect(history.state).toMatchObject({ canUndo: true, canRedo: false, undoDepth: 2 });

    const undoMute = history.undo();
    expect(undoMute.revision).toBe(3n);
    expect(undoMute.changeSet.label).toBe('Undo: Mute music');
    expect(engine.getSnapshot().tracks.track_music?.audio).toMatchObject({ muted: false });
    history.undo();
    expect(await canonicalHash(engine.getSnapshot())).toBe(beforeHash);
    expect(history.state).toMatchObject({ canUndo: false, canRedo: true, redoDepth: 2 });

    history.redo();
    history.redo();
    expect(engine.revision).toBe(6n);
    expect(engine.getSnapshot().items.item_title?.range.startUs).toBe(1_000_000);
    expect(engine.getSnapshot().tracks.track_music?.audio).toMatchObject({ muted: true });
  });

  it('clears redo after a branch edit, enforces its bound and detects external divergence', () => {
    const engine = new TransactionEngine(project, validate);
    const history = new TransactionHistory(engine, { maxEntries: 1 });
    const commands = new EditingCommands(history);
    commands.setTrackMuted({ trackId: 'track_music', value: true, label: 'First' });
    commands.setTrackMuted({ trackId: 'track_music', value: false, label: 'Second' });
    expect(history.state.undoDepth).toBe(1);
    history.undo();
    commands.setTrackMuted({ trackId: 'track_music', value: true, label: 'Branch' });
    expect(history.state.redoDepth).toBe(0);
    expect(() => history.redo()).toThrow(/no edit to redo/u);

    engine.edit({ baseRevision: engine.revision }, transaction => {
      transaction.setField('tracks', 'track_music', ['enabled'], false);
    });
    expect(() => history.undo()).toThrow(/expected revision/u);
  });
});
