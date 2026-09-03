import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelionsdk/core';
import type { AelionProject } from '@aelionsdk/project-schema';
import { ProjectValidator } from '@aelionsdk/project-schema';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  EditingCommands,
  planTimelineMove,
  speculateProject,
  writeTimelinePlacements,
  TransactionEngine,
  type TimelinePlacement,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);
let project: AelionProject;
let validate: (value: unknown) => { readonly ok: boolean; readonly diagnostics: readonly never[] };

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

beforeAll(async () => {
  const [projectSchema, materialInstanceSchema, fixture] = await Promise.all([
    readJson('schemas/project/v2.0/project.schema.json'),
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

function create(): { engine: TransactionEngine; commands: EditingCommands } {
  const engine = new TransactionEngine(project, validate);
  return { engine, commands: new EditingCommands(engine) };
}

function placements(
  entries: Record<string, { trackId: string; startUs: number }>,
): ReadonlyMap<string, TimelinePlacement> {
  return new Map(Object.entries(entries));
}

describe('applyPlacements', () => {
  it('commits a multi-Item, cross-Track move as one revision', () => {
    const { engine, commands } = create();
    const before = engine.revision;
    const commit = commands.applyPlacements({
      placements: placements({
        item_video_b: { trackId: 'track_video_main', startUs: 0 },
        item_video_a: { trackId: 'track_video_main', startUs: 5_200_000 },
        item_title: { trackId: 'track_title', startUs: 2_000_000 },
      }),
      label: 'Reorder',
    });
    expect(commit.revision).toBe(before + 1n);
    const after = engine.getSnapshot();
    expect(after.items.item_video_b?.range.startUs).toBe(0);
    expect(after.items.item_video_a?.range.startUs).toBe(5_200_000);
    expect(after.items.item_title?.range.startUs).toBe(2_000_000);
  });

  it('moves an Item between Tracks and repairs both Track item lists', () => {
    const { engine, commands } = create();
    commands.applyPlacements({
      placements: placements({ item_title: { trackId: 'track_video_main', startUs: 20_000_000 } }),
    });
    const after = engine.getSnapshot();
    expect(after.items.item_title?.trackId).toBe('track_video_main');
    expect(after.tracks.track_title?.itemIds).not.toContain('item_title');
    expect(after.tracks.track_video_main?.itemIds).toContain('item_title');
  });

  it('re-centres a Transition on the cut its pair now shares', () => {
    const { engine, commands } = create();
    const original = engine.getSnapshot().transitions.transition_ab;
    expect(original).toBeDefined();
    // Slide both takes later by a second; the Transition has to travel with them.
    commands.applyPlacements({
      placements: placements({
        item_video_a: { trackId: 'track_video_main', startUs: 1_000_000 },
        item_video_b: { trackId: 'track_video_main', startUs: 5_800_000 },
      }),
    });
    const moved = engine.getSnapshot().transitions.transition_ab;
    expect(moved?.range.startUs).toBe((original?.range.startUs ?? 0) + 1_000_000);
    expect(moved?.fromItemId).toBe('item_video_a');
    expect(moved?.toItemId).toBe('item_video_b');
  });

  it('re-derives Transition direction when a reorder swaps the pair', () => {
    const { engine, commands } = create();
    commands.applyPlacements({
      placements: placements({
        item_video_b: { trackId: 'track_video_main', startUs: 0 },
        item_video_a: { trackId: 'track_video_main', startUs: 4_800_000 },
      }),
    });
    const swapped = engine.getSnapshot().transitions.transition_ab;
    // `b` now plays first, so it is the Transition's outgoing side.
    expect(swapped?.fromItemId).toBe('item_video_b');
    expect(swapped?.toItemId).toBe('item_video_a');
  });

  it('drops a Transition whose pair is pulled onto different Tracks', () => {
    const { engine, commands } = create();
    const instanceId = engine.getSnapshot().transitions.transition_ab?.materialInstanceId;
    commands.applyPlacements({
      placements: placements({ item_video_b: { trackId: 'track_title', startUs: 12_000_000 } }),
    });
    const after = engine.getSnapshot();
    expect(after.transitions.transition_ab).toBeUndefined();
    expect(after.sequences.seq_main?.transitionIds).not.toContain('transition_ab');
    expect(
      instanceId === undefined ? undefined : after.materialInstances[instanceId],
    ).toBeUndefined();
  });

  it('refuses to separate a Transition pair when the caller asks it not to', () => {
    const { commands } = create();
    expect(() =>
      commands.applyPlacements({
        placements: placements({ item_video_b: { trackId: 'track_title', startUs: 12_000_000 } }),
        dropSeparatedTransitions: false,
      }),
    ).toThrow(/COMMAND_TRANSITION_PAIR_SEPARATED|different Tracks/u);
  });

  it('rejects a layout that stacks Items on an exclusive Track', () => {
    const { engine, commands } = create();
    engine.edit({ baseRevision: engine.revision }, transaction => {
      transaction.setField('tracks', 'track_title', ['occupancy'], 'exclusive');
    });
    // item_title occupies 0.9s..3.9s on that lane.
    expect(() =>
      commands.applyPlacements({
        placements: placements({ item_video_b: { trackId: 'track_title', startUs: 1_000_000 } }),
      }),
    ).toThrow(/COMMAND_TRACK_OCCUPANCY_OVERLAP|exclusive/u);
  });

  it('permits the overlap a Transition is made of, even on an exclusive Track', () => {
    // The two takes overlap by the length of their cross dissolve. An exclusive
    // storyline has to allow exactly that, or a dissolve and a packed lane
    // become mutually exclusive.
    const { engine, commands } = create();
    engine.edit({ baseRevision: engine.revision }, transaction => {
      transaction.setField('tracks', 'track_video_main', ['role'], 'storyline');
    });
    expect(() =>
      commands.applyPlacements({
        placements: placements({
          item_video_a: { trackId: 'track_video_main', startUs: 1_000_000 },
          item_video_b: { trackId: 'track_video_main', startUs: 5_800_000 },
        }),
      }),
    ).not.toThrow();
  });

  it('refuses a locked Track on either end of the move', () => {
    const { engine, commands } = create();
    engine.edit({ baseRevision: engine.revision }, transaction => {
      transaction.setField('tracks', 'track_title', ['locked'], true);
    });
    expect(() =>
      commands.applyPlacements({
        placements: placements({ item_title: { trackId: 'track_title', startUs: 0 } }),
      }),
    ).toThrow(/COMMAND_TRACK_LOCKED|locked/u);
  });

  it('accepts a linked Item, which the single-Item move commands refuse outright', () => {
    const { engine, commands } = create();
    const linked = engine.getSnapshot().items.item_video_a?.linkGroupId;
    expect(linked).toBeDefined();
    // moveItem rejects any linked Item, which is why a real drag cannot use it.
    expect(() => commands.moveItem({ itemId: 'item_video_a', startUs: 200_000 })).toThrow(
      /is linked/u,
    );
    commands.applyPlacements({
      placements: placements({
        item_video_a: { trackId: 'track_video_main', startUs: 200_000 },
        item_audio_a: { trackId: 'track_audio_sync', startUs: 200_000 },
      }),
    });
    const after = engine.getSnapshot();
    expect(after.items.item_video_a?.range.startUs).toBe(200_000);
    expect(after.items.item_audio_a?.range.startUs).toBe(200_000);
  });

  it('writes exactly the layout the planner resolved', () => {
    const { engine, commands } = create();
    engine.edit({ baseRevision: engine.revision }, transaction => {
      transaction.setField('tracks', 'track_video_main', ['role'], 'storyline');
    });
    const plan = planTimelineMove(engine.getSnapshot(), {
      movedItemId: 'item_video_b',
      targetTrackId: 'track_video_main',
      targetStartUs: 0,
    });
    expect(plan).toBeDefined();
    commands.applyPlacements({ placements: plan?.placements ?? new Map() });
    const after = engine.getSnapshot();
    for (const [id, at] of plan?.placements ?? []) {
      expect(after.items[id]?.range.startUs).toBe(at.startUs);
      expect(after.items[id]?.trackId).toBe(at.trackId);
    }
  });

  it('uses the same placement writer for speculative preview and commit', () => {
    const { engine, commands } = create();
    const before = engine.getSnapshot();
    const plan = planTimelineMove(before, {
      movedItemId: 'item_video_b',
      targetTrackId: 'track_video_main',
      targetStartUs: 0,
    });
    expect(plan).toBeDefined();
    const placements = plan?.placements ?? new Map();
    const speculative = speculateProject(before, transaction => {
      writeTimelinePlacements(transaction, before, placements);
    });
    const committed = commands.applyPlacements({ placements }).snapshot;
    expect(speculative).toEqual(committed);
  });
});

describe('speculateProject', () => {
  it('returns the proposed Project without committing anything', () => {
    const { engine } = create();
    const before = engine.getSnapshot();
    const revision = engine.revision;
    const speculated = speculateProject(before, transaction => {
      transaction.setField('items', 'item_video_a', ['range', 'startUs'], 3_000_000);
    });
    expect(speculated.items.item_video_a?.range.startUs).toBe(3_000_000);
    // Nothing about the live Project moved.
    expect(engine.revision).toBe(revision);
    expect(engine.getSnapshot()).toBe(before);
    expect(before.items.item_video_a?.range.startUs).toBe(0);
  });

  it('never notifies a change listener', () => {
    const { engine } = create();
    let notified = 0;
    engine.subscribe(() => {
      notified += 1;
    });
    speculateProject(engine.getSnapshot(), transaction => {
      transaction.setField('items', 'item_video_a', ['range', 'startUs'], 3_000_000);
    });
    expect(notified).toBe(0);
  });

  it('shares untouched subtrees, so speculating per pointer move stays cheap', () => {
    const { engine } = create();
    const before = engine.getSnapshot();
    const speculated = speculateProject(before, transaction => {
      transaction.setField('items', 'item_video_a', ['range', 'startUs'], 3_000_000);
    });
    expect(speculated.tracks).toBe(before.tracks);
    expect(speculated.assets).toBe(before.assets);
    expect(speculated.items.item_video_b).toBe(before.items.item_video_b);
  });

  it('hands back the same Project when the transaction is empty', () => {
    const { engine } = create();
    const before = engine.getSnapshot();
    expect(speculateProject(before, () => undefined)).toBe(before);
  });
});
