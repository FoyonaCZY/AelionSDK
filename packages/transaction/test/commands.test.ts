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

function installProfessionalEditTrack(engine: TransactionEngine): void {
  const values = [
    { id: 'edit_left', startUs: 0, sourceStartUs: 0 },
    { id: 'edit_middle', startUs: 2_000_000, sourceStartUs: 2_000_000 },
    { id: 'edit_right', startUs: 4_000_000, sourceStartUs: 4_000_000 },
  ].map(value => {
    const item = videoItem(value.id, 'track_edit');
    item.range = { startUs: value.startUs, durationUs: 2_000_000 };
    const source = item.source as JsonObject;
    source.sourceRange = { startUs: value.sourceStartUs, durationUs: 2_000_000 };
    return item;
  });
  engine.edit({ baseRevision: engine.revision }, transaction => {
    transaction.createEntity('tracks', 'track_edit', {
      id: 'track_edit',
      sequenceId: 'seq_main',
      kind: 'visual',
      enabled: true,
      locked: false,
      itemIds: values.map(value => value.id),
      materialInstanceIds: [],
    });
    transaction.listInsert('sequences', 'seq_main', ['trackIds'], 'track_edit');
    for (const item of values) transaction.createEntity('items', item.id, item);
  });
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

  it('edits marker ranges and selection metadata as invertible domain commands', async () => {
    const { engine, commands } = create();
    const before = await canonicalHash(engine.getSnapshot());
    const added = commands.addMarker({
      marker: {
        id: 'marker_item_note',
        owner: { type: 'item', id: 'item_video_a' },
        timeUs: 100_000,
        durationUs: 50_000,
        label: 'Note',
      },
    });
    expect(added.snapshot.items.item_video_a?.markerIds).toContain('marker_item_note');
    expect(added.snapshot.sequences.seq_main?.markerIds).toContain('marker_item_note');

    const updated = commands.updateMarker({
      markerId: 'marker_item_note',
      timeUs: 200_000,
      durationUs: 75_000,
      markerLabel: null,
      markerColor: '#123456',
    });
    expect(updated.snapshot.markers.marker_item_note).toMatchObject({
      timeUs: 200_000,
      durationUs: 75_000,
      color: '#123456',
    });
    expect(updated.snapshot.markers.marker_item_note?.label).toBeUndefined();

    const selected = commands.setSelectionMetadata({
      sequenceId: 'seq_main',
      itemIds: ['item_video_a', 'item_audio_a'],
      range: { startUs: 100_000, durationUs: 500_000 },
    });
    expect(selected.snapshot.sequences.seq_main?.extensions).toMatchObject({
      'aelion.selection': {
        itemIds: ['item_video_a', 'item_audio_a'],
        range: { startUs: 100_000, durationUs: 500_000 },
      },
    });
    const removed = commands.removeMarker({ markerId: 'marker_item_note' });
    expect(removed.snapshot.markers.marker_item_note).toBeUndefined();

    const restored = structuredClone(removed.snapshot);
    const { applyOperations } = await import('../src/index.js');
    applyOperations(restored, removed.inverse);
    applyOperations(restored, selected.inverse);
    applyOperations(restored, updated.inverse);
    applyOperations(restored, added.inverse);
    expect(await canonicalHash(restored)).toBe(before);
  });

  it('trims, splits and deletes LinkGroups without exposing partial membership', () => {
    const { engine, commands } = create();
    installProfessionalEditTrack(engine);
    const parallel = videoItem('edit_parallel', 'track_edit_parallel');
    parallel.range = { startUs: 0, durationUs: 2_000_000 };
    (parallel.source as JsonObject).sourceRange = { startUs: 0, durationUs: 2_000_000 };
    engine.edit({ baseRevision: engine.revision }, transaction => {
      transaction.createEntity('tracks', 'track_edit_parallel', {
        id: 'track_edit_parallel',
        sequenceId: 'seq_main',
        kind: 'visual',
        enabled: true,
        locked: false,
        itemIds: [parallel.id],
        materialInstanceIds: [],
      });
      transaction.listInsert('sequences', 'seq_main', ['trackIds'], 'track_edit_parallel');
      transaction.createEntity('items', parallel.id, parallel);
    });
    commands.linkItems({
      groupId: 'group_edit',
      kind: 'edit-group',
      itemIds: ['edit_left', 'edit_parallel'],
    });
    const trimmed = commands.trimLinkedGroup({
      groupId: 'group_edit',
      edge: 'start',
      amountUs: 100_000,
    });
    expect(trimmed.snapshot.items.edit_left).toMatchObject({
      range: { startUs: 100_000, durationUs: 1_900_000 },
      source: { sourceRange: { startUs: 100_000, durationUs: 1_900_000 } },
    });
    expect(trimmed.snapshot.items.edit_parallel).toMatchObject({
      range: { startUs: 100_000, durationUs: 1_900_000 },
    });

    const split = commands.splitLinkedGroup({
      groupId: 'group_edit',
      rightGroupId: 'group_edit_right',
      atUs: 1_000_000,
      rightItemIds: {
        edit_left: 'edit_left_right',
        edit_parallel: 'edit_parallel_right',
      },
    });
    expect(split.commit.snapshot.linkGroups.group_edit?.itemIds).toEqual([
      'edit_left',
      'edit_parallel',
    ]);
    expect(split.commit.snapshot.linkGroups.group_edit_right?.itemIds).toEqual([
      'edit_left_right',
      'edit_parallel_right',
    ]);
    expect(split.commit.snapshot.items.edit_left_right).toMatchObject({
      linkGroupId: 'group_edit_right',
      range: { startUs: 1_000_000, durationUs: 1_000_000 },
      source: { sourceRange: { startUs: 1_000_000, durationUs: 1_000_000 } },
    });

    const removed = commands.removeLinkedGroup({ groupId: 'group_edit_right' });
    expect(removed.snapshot.linkGroups.group_edit_right).toBeUndefined();
    expect(removed.snapshot.items.edit_left_right).toBeUndefined();
    expect(removed.snapshot.items.edit_parallel_right).toBeUndefined();
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
    commands.setTrackSolo({ trackId: 'track_music', value: true, baseRevision: 5n });
    const reordered = commands.reorderTrack({
      sequenceId: 'seq_main',
      trackId: 'track_title',
      beforeTrackId: 'track_video_main',
      baseRevision: 6n,
    });
    expect(reordered.snapshot.tracks.track_title).toMatchObject({
      enabled: false,
      locked: false,
    });
    expect(reordered.snapshot.tracks.track_music?.audio).toMatchObject({ muted: true, solo: true });
    expect(reordered.snapshot.sequences.seq_main?.trackIds[0]).toBe('track_title');
  });

  it('rejects audio mixer commands for non-audio Tracks without changing revision', () => {
    const { engine, commands } = create();
    expect(() => commands.setTrackSolo({ trackId: 'track_title', value: true })).toThrow(
      /not an audio Track/u,
    );
    expect(() => commands.setTrackMuted({ trackId: 'track_title', value: true })).toThrow(
      /not an audio Track/u,
    );
    expect(engine.revision).toBe(0n);
  });

  it('links, moves and unlinks a cross-Track edit group as atomic reversible commits', async () => {
    const { engine, commands } = create();
    const beforeHash = await canonicalHash(engine.getSnapshot());
    const linked = commands.linkItems({
      groupId: 'link_edit',
      itemIds: ['item_title', 'item_music'],
      kind: 'edit-group',
    });
    expect(linked.snapshot.linkGroups.link_edit).toEqual({
      id: 'link_edit',
      kind: 'edit-group',
      itemIds: ['item_title', 'item_music'],
    });
    expect(linked.snapshot.items.item_title?.linkGroupId).toBe('link_edit');
    expect(linked.snapshot.items.item_music?.linkGroupId).toBe('link_edit');

    const moved = commands.moveLinkedGroup({ groupId: 'link_edit', deltaUs: 100_000 });
    expect(moved.snapshot.items.item_title?.range.startUs).toBe(1_000_000);
    expect(moved.snapshot.items.item_music?.range.startUs).toBe(100_000);
    expect(moved.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 0, durationUs: 10_100_000 },
    ]);

    const unlinked = commands.unlinkItems({ groupId: 'link_edit', itemIds: ['item_title'] });
    expect(unlinked.snapshot.linkGroups.link_edit).toBeUndefined();
    expect(unlinked.snapshot.items.item_title?.linkGroupId).toBeUndefined();
    expect(unlinked.snapshot.items.item_music?.linkGroupId).toBeUndefined();

    const restored = structuredClone(unlinked.snapshot);
    const { applyOperations } = await import('../src/index.js');
    applyOperations(restored, unlinked.inverse);
    applyOperations(restored, moved.inverse);
    applyOperations(restored, linked.inverse);
    expect(await canonicalHash(restored)).toBe(beforeHash);
    expect(engine.revision).toBe(3n);
  });

  it('rejects linked moves that would break a Transition or cross Sequence time zero', () => {
    const { engine, commands } = create();
    expect(() => commands.moveLinkedGroup({ groupId: 'link_av_a', deltaUs: 100_000 })).toThrow(
      /crosses the LinkGroup boundary/u,
    );
    expect(() => commands.moveLinkedGroup({ groupId: 'link_av_a', deltaUs: -1 })).toThrow(
      /before Sequence time zero/u,
    );
    expect(engine.revision).toBe(0n);
  });

  it('slips linear and curve media without moving their timeline ranges', () => {
    const { engine, commands } = create();
    installProfessionalEditTrack(engine);
    const linear = commands.slipItem({
      itemId: 'edit_middle',
      deltaSourceUs: 250_000,
      baseRevision: 1n,
    });
    expect(linear.snapshot.items.edit_middle).toMatchObject({
      range: { startUs: 2_000_000, durationUs: 2_000_000 },
      source: { sourceRange: { startUs: 2_250_000, durationUs: 2_000_000 } },
    });

    engine.edit({ baseRevision: 2n }, transaction => {
      transaction.setField('items', 'edit_middle', ['source', 'sourceRange'], {
        startUs: 1_000_000,
        durationUs: 4_000_000,
      });
      transaction.setField('items', 'edit_middle', ['source', 'timeMapping'], {
        type: 'curve',
        boundary: 'error',
        points: [
          { itemTimeUs: 0, sourceTimeUs: 1_000_000, interpolation: 'linear' },
          { itemTimeUs: 1_000_000, sourceTimeUs: 3_000_000, interpolation: 'hold' },
          { itemTimeUs: 2_000_000, sourceTimeUs: 3_000_000, interpolation: 'linear' },
        ],
      });
    });
    const curve = commands.slipItem({
      itemId: 'edit_middle',
      deltaSourceUs: 500_000,
      baseRevision: 3n,
    });
    expect(curve.snapshot.items.edit_middle?.source).toMatchObject({
      sourceRange: { startUs: 1_500_000, durationUs: 4_000_000 },
      timeMapping: {
        points: [
          { sourceTimeUs: 1_500_000 },
          { sourceTimeUs: 3_500_000 },
          { sourceTimeUs: 3_500_000 },
        ],
      },
    });
  });

  it('rolls an adjacent boundary while preserving the combined timeline extent', () => {
    const { engine, commands } = create();
    installProfessionalEditTrack(engine);
    const commit = commands.rollEdit({
      leftItemId: 'edit_left',
      rightItemId: 'edit_middle',
      toUs: 2_250_000,
      baseRevision: 1n,
    });
    expect(commit.snapshot.items.edit_left).toMatchObject({
      range: { startUs: 0, durationUs: 2_250_000 },
      source: { sourceRange: { startUs: 0, durationUs: 2_250_000 } },
    });
    expect(commit.snapshot.items.edit_middle).toMatchObject({
      range: { startUs: 2_250_000, durationUs: 1_750_000 },
      source: { sourceRange: { startUs: 2_250_000, durationUs: 1_750_000 } },
    });
    expect(commit.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 0, durationUs: 4_000_000 },
    ]);
  });

  it('slides an Item and compensates both adjacent edit boundaries atomically', async () => {
    const { engine, commands } = create();
    installProfessionalEditTrack(engine);
    const before = await canonicalHash(engine.getSnapshot());
    const commit = commands.slideItem({
      itemId: 'edit_middle',
      deltaUs: 250_000,
      baseRevision: 1n,
    });
    expect(commit.snapshot.items.edit_left).toMatchObject({
      range: { durationUs: 2_250_000 },
      source: { sourceRange: { durationUs: 2_250_000 } },
    });
    expect(commit.snapshot.items.edit_middle?.range).toEqual({
      startUs: 2_250_000,
      durationUs: 2_000_000,
    });
    expect(commit.snapshot.items.edit_right).toMatchObject({
      range: { startUs: 4_250_000, durationUs: 1_750_000 },
      source: { sourceRange: { startUs: 4_250_000, durationUs: 1_750_000 } },
    });

    const restored = structuredClone(commit.snapshot);
    const { applyOperations } = await import('../src/index.js');
    applyOperations(restored, commit.inverse);
    expect(await canonicalHash(restored)).toBe(before);
  });

  it('ripple-inserts and removes an Item while shifting later Items and Sequence Markers', async () => {
    const { engine, commands } = create();
    installProfessionalEditTrack(engine);
    engine.edit({ baseRevision: 1n }, transaction => {
      transaction.createEntity('markers', 'marker_ripple', {
        id: 'marker_ripple',
        owner: { type: 'sequence', id: 'seq_main' },
        timeUs: 4_000_000,
        durationUs: 0,
      });
      transaction.listInsert('sequences', 'seq_main', ['markerIds'], 'marker_ripple');
    });
    const before = await canonicalHash(engine.getSnapshot());
    const insertedItem = videoItem('edit_inserted', 'track_edit');
    insertedItem.range = { startUs: 2_000_000, durationUs: 500_000 };
    const source = insertedItem.source as JsonObject;
    source.sourceRange = { startUs: 6_000_000, durationUs: 500_000 };

    const inserted = commands.rippleInsertItem({
      item: insertedItem,
      beforeItemId: 'edit_middle',
      trackIds: ['track_edit'],
      baseRevision: 2n,
    });
    expect(inserted.snapshot.tracks.track_edit?.itemIds).toEqual([
      'edit_left',
      'edit_inserted',
      'edit_middle',
      'edit_right',
    ]);
    expect(inserted.snapshot.items.edit_middle?.range.startUs).toBe(2_500_000);
    expect(inserted.snapshot.items.edit_right?.range.startUs).toBe(4_500_000);
    expect(inserted.snapshot.markers.marker_ripple?.timeUs).toBe(4_500_000);

    const removed = commands.rippleRemoveItem({
      itemId: 'edit_inserted',
      trackIds: ['track_edit'],
      baseRevision: 3n,
    });
    expect(removed.snapshot.items.edit_inserted).toBeUndefined();
    expect(removed.snapshot.items.edit_middle?.range.startUs).toBe(2_000_000);
    expect(removed.snapshot.items.edit_right?.range.startUs).toBe(4_000_000);
    expect(removed.snapshot.markers.marker_ripple?.timeUs).toBe(4_000_000);
    expect(await canonicalHash(removed.snapshot)).toBe(before);
  });

  it('rejects a partial ripple that would tear an AV LinkGroup', () => {
    const { engine, commands } = create();
    const item = videoItem('ripple_conflict');
    item.range = { startUs: 0, durationUs: 100_000 };
    expect(() =>
      commands.rippleInsertItem({
        item,
        trackIds: ['track_video_main'],
        beforeItemId: 'item_video_a',
      }),
    ).toThrow(/only part of LinkGroup/u);
    expect(engine.revision).toBe(0n);
  });
});

describe('TransactionHistory', () => {
  it('coalesces interactive updates into one undo entry and can cancel without redo', () => {
    const engine = new TransactionEngine(project, validate);
    const history = new TransactionHistory(engine);
    const initialStartUs = engine.getSnapshot().items.item_title?.range.startUs;

    for (let step = 1; step <= 250; step += 1) {
      const startUs = step * 3_000;
      history.edit({ label: 'Drag title', historyGroup: 'drag-title' }, transaction => {
        transaction.setField('items', 'item_title', ['range', 'startUs'], startUs);
      });
    }
    expect(history.state).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(engine.getSnapshot().items.item_title?.range.startUs).toBe(750_000);
    history.finishGroup('drag-title');
    history.undo();
    expect(engine.getSnapshot().items.item_title?.range.startUs).toBe(initialStartUs);
    history.redo();
    expect(engine.getSnapshot().items.item_title?.range.startUs).toBe(750_000);

    history.edit({ label: 'Drag title', historyGroup: 'cancel-drag' }, transaction => {
      transaction.setField('items', 'item_title', ['range', 'startUs'], 900_000);
    });
    const cancelled = history.cancelGroup('cancel-drag');
    expect(cancelled?.changeSet.label).toBe('Cancel: Drag title');
    expect(engine.getSnapshot().items.item_title?.range.startUs).toBe(750_000);
    expect(history.state).toMatchObject({ undoDepth: 1, redoDepth: 0 });
  });

  it('undoes and redoes an optional solo field without changing its legacy default', () => {
    const engine = new TransactionEngine(project, validate);
    const history = new TransactionHistory(engine);
    const commands = new EditingCommands(history);
    expect(engine.getSnapshot().tracks.track_music?.audio?.solo).toBeUndefined();

    const solo = commands.setTrackSolo({
      trackId: 'track_music',
      value: true,
      label: 'Solo music',
    });
    expect(solo.changeSet.affectedEntityIds).toEqual(['track_music']);
    expect(solo.changeSet.affectedRanges).toEqual([
      { sequenceId: 'seq_main', startUs: 0, durationUs: 10_000_000 },
    ]);
    expect(engine.getSnapshot().tracks.track_music?.audio?.solo).toBe(true);

    history.undo();
    expect(engine.getSnapshot().tracks.track_music?.audio?.solo).toBeUndefined();
    history.redo();
    expect(engine.getSnapshot().tracks.track_music?.audio?.solo).toBe(true);
  });

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
