import type { AelionProject } from '@aelionsdk/project-schema';
import { describe, expect, it } from 'vitest';

import {
  placementsChange,
  planTimelineMove,
  storylineTrackId,
  violatesOccupancy,
} from '../src/index.js';

const SECOND = 1_000_000;

interface Spec {
  readonly id: string;
  readonly startUs: number;
  readonly durationUs: number;
  readonly linkGroupId?: string;
}

interface TrackSpec {
  readonly kind: 'visual' | 'audio' | 'caption';
  readonly items: readonly Spec[];
  readonly role?: 'storyline' | 'overlay';
  readonly occupancy?: 'exclusive' | 'free';
}

/**
 * The smallest Project the layout solver reads: Tracks, their Item order and
 * each Item's range. Everything else the schema requires is irrelevant to
 * layout and deliberately omitted.
 */
function project(tracks: Record<string, TrackSpec>): AelionProject {
  const items: Record<string, unknown> = {};
  const trackEntities: Record<string, unknown> = {};
  const linkGroups: Record<string, { id: string; itemIds: string[] }> = {};
  for (const [trackId, track] of Object.entries(tracks)) {
    for (const spec of track.items) {
      items[spec.id] = {
        id: spec.id,
        trackId,
        type: track.kind === 'audio' ? 'audio' : 'video',
        enabled: true,
        range: { startUs: spec.startUs, durationUs: spec.durationUs },
        materialInstanceIds: [],
        ...(spec.linkGroupId === undefined ? {} : { linkGroupId: spec.linkGroupId }),
      };
      if (spec.linkGroupId !== undefined) {
        const group = (linkGroups[spec.linkGroupId] ??= { id: spec.linkGroupId, itemIds: [] });
        group.itemIds.push(spec.id);
      }
    }
    trackEntities[trackId] = {
      id: trackId,
      sequenceId: 'sequence',
      kind: track.kind,
      ...(track.role === undefined ? {} : { role: track.role }),
      ...(track.occupancy === undefined ? {} : { occupancy: track.occupancy }),
      enabled: true,
      locked: false,
      itemIds: track.items.map(spec => spec.id),
      materialInstanceIds: [],
    };
  }
  return {
    settings: { defaultSequenceId: 'sequence' },
    sequences: { sequence: { id: 'sequence', trackIds: Object.keys(tracks) } },
    tracks: trackEntities,
    items,
    linkGroups,
    transitions: {},
  } as unknown as AelionProject;
}

function starts(
  plan: ReturnType<typeof planTimelineMove>,
): Record<string, { trackId: string; startUs: number }> {
  const out: Record<string, { trackId: string; startUs: number }> = {};
  for (const [id, at] of plan?.placements ?? []) out[id] = { ...at };
  return out;
}

describe('storylineTrackId', () => {
  it('reads the declared role rather than inferring one from Track order', () => {
    const declared = project({
      V1: { kind: 'visual', items: [] },
      V2: { kind: 'visual', items: [], role: 'storyline' },
    });
    expect(storylineTrackId(declared)).toBe('V2');
  });

  it('is undefined when no Track claims the role, leaving every lane free', () => {
    expect(storylineTrackId(project({ V1: { kind: 'visual', items: [] } }))).toBeUndefined();
  });
});

describe('planTimelineMove on the storyline', () => {
  const storyline = () =>
    project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'a', startUs: 0, durationUs: 2 * SECOND },
          { id: 'b', startUs: 2 * SECOND, durationUs: 3 * SECOND },
          { id: 'c', startUs: 5 * SECOND, durationUs: 4 * SECOND },
        ],
      },
    });

  it('packs with no gap and no overlap after moving a clip earlier', () => {
    const plan = planTimelineMove(storyline(), {
      movedItemId: 'c',
      targetTrackId: 'V1',
      targetStartUs: 0,
    });
    expect(plan?.mode).toBe('reorder');
    expect(starts(plan)).toEqual({
      c: { trackId: 'V1', startUs: 0 },
      a: { trackId: 'V1', startUs: 4 * SECOND },
      b: { trackId: 'V1', startUs: 6 * SECOND },
    });
  });

  it('moves a clip to the end and closes the hole it left', () => {
    const plan = planTimelineMove(storyline(), {
      movedItemId: 'a',
      targetTrackId: 'V1',
      targetStartUs: 9 * SECOND,
    });
    expect(starts(plan)).toEqual({
      b: { trackId: 'V1', startUs: 0 },
      c: { trackId: 'V1', startUs: 3 * SECOND },
      a: { trackId: 'V1', startUs: 7 * SECOND },
    });
  });

  it('takes the slot once the drag passes the midpoint of the clip holding it', () => {
    // `b` spans 2s..5s, so its midpoint is 3.5s. Landing before that takes b's
    // slot; landing after it leaves the original order, which the plan reports
    // by placing nothing and drawing the ghost where the clip already is.
    const before = planTimelineMove(storyline(), {
      movedItemId: 'c',
      targetTrackId: 'V1',
      targetStartUs: 3 * SECOND,
    });
    const after = planTimelineMove(storyline(), {
      movedItemId: 'c',
      targetTrackId: 'V1',
      targetStartUs: 4 * SECOND,
    });
    expect(starts(before).c?.startUs).toBe(2 * SECOND);
    expect(before?.ghost.startUs).toBe(2 * SECOND);
    expect(starts(after)).toEqual({});
    expect(after?.ghost.startUs).toBe(5 * SECOND);
  });

  it('keeps the storyline origin when it does not begin at zero', () => {
    const shifted = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'a', startUs: 4 * SECOND, durationUs: 2 * SECOND },
          { id: 'b', startUs: 6 * SECOND, durationUs: 2 * SECOND },
        ],
      },
    });
    const plan = planTimelineMove(shifted, {
      movedItemId: 'b',
      targetTrackId: 'V1',
      targetStartUs: 0,
    });
    expect(starts(plan)).toEqual({
      b: { trackId: 'V1', startUs: 4 * SECOND },
      a: { trackId: 'V1', startUs: 6 * SECOND },
    });
  });

  it('treats a Gap as an ordinary member, so deliberate blank space survives packing', () => {
    const withGap = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'a', startUs: 0, durationUs: 2 * SECOND },
          { id: 'pause', startUs: 2 * SECOND, durationUs: SECOND },
          { id: 'b', startUs: 3 * SECOND, durationUs: 2 * SECOND },
        ],
      },
    });
    const plan = planTimelineMove(withGap, {
      movedItemId: 'b',
      targetTrackId: 'V1',
      targetStartUs: 0,
    });
    // The pause keeps its length and its place in the order; only the drag moves.
    expect(starts(plan)).toEqual({
      b: { trackId: 'V1', startUs: 0 },
      a: { trackId: 'V1', startUs: 2 * SECOND },
      pause: { trackId: 'V1', startUs: 4 * SECOND },
    });
  });

  it('leaves every lane free when no Track declares the storyline role', () => {
    const noRole = project({
      V1: {
        kind: 'visual',
        items: [
          { id: 'a', startUs: 0, durationUs: 2 * SECOND },
          { id: 'b', startUs: 6 * SECOND, durationUs: 2 * SECOND },
        ],
      },
    });
    const plan = planTimelineMove(noRole, {
      movedItemId: 'b',
      targetTrackId: 'V1',
      targetStartUs: 9 * SECOND,
    });
    expect(plan?.mode).toBe('free');
    expect(starts(plan)).toEqual({ b: { trackId: 'V1', startUs: 9 * SECOND } });
  });
});

describe('planTimelineMove off the storyline', () => {
  const withOverlay = () =>
    project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'a', startUs: 0, durationUs: 2 * SECOND },
          { id: 'b', startUs: 2 * SECOND, durationUs: 2 * SECOND },
        ],
      },
      V2: { kind: 'visual', items: [{ id: 'title', startUs: 5 * SECOND, durationUs: SECOND }] },
    });

  it('drops freely on an upper track without disturbing anyone', () => {
    const plan = planTimelineMove(withOverlay(), {
      movedItemId: 'title',
      targetTrackId: 'V2',
      targetStartUs: 7 * SECOND + 123,
    });
    expect(plan?.mode).toBe('free');
    expect(plan?.insertAtUs).toBeUndefined();
    expect(starts(plan)).toEqual({ title: { trackId: 'V2', startUs: 7 * SECOND + 123 } });
  });

  it('closes the storyline when a clip is lifted off it', () => {
    const plan = planTimelineMove(withOverlay(), {
      movedItemId: 'a',
      targetTrackId: 'V2',
      targetStartUs: 8 * SECOND,
    });
    expect(starts(plan)).toEqual({
      a: { trackId: 'V2', startUs: 8 * SECOND },
      b: { trackId: 'V1', startUs: 0 },
    });
  });

  it('inserts into the storyline when a floating clip is dropped onto it', () => {
    const plan = planTimelineMove(withOverlay(), {
      movedItemId: 'title',
      targetTrackId: 'V1',
      targetStartUs: 0,
    });
    expect(plan?.mode).toBe('reorder');
    expect(starts(plan)).toEqual({
      title: { trackId: 'V1', startUs: 0 },
      a: { trackId: 'V1', startUs: SECOND },
      b: { trackId: 'V1', startUs: 3 * SECOND },
    });
  });

  it('refuses a drop onto a locked Track', () => {
    const locked = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [{ id: 'a', startUs: 0, durationUs: SECOND }],
      },
      V2: { kind: 'visual', items: [] },
    });
    (locked.tracks.V2 as { locked: boolean }).locked = true;
    expect(
      planTimelineMove(locked, { movedItemId: 'a', targetTrackId: 'V2', targetStartUs: 0 }),
    ).toBeUndefined();
  });
});

describe('planTimelineMove with linked audio', () => {
  it('keeps a linked pair aligned while the storyline repacks', () => {
    const linked = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'v1', startUs: 0, durationUs: 2 * SECOND, linkGroupId: 'g' },
          { id: 'v2', startUs: 2 * SECOND, durationUs: 3 * SECOND },
        ],
      },
      A1: {
        kind: 'audio',
        items: [{ id: 'a1', startUs: 0, durationUs: 2 * SECOND, linkGroupId: 'g' }],
      },
    });
    const plan = planTimelineMove(linked, {
      movedItemId: 'v1',
      targetTrackId: 'V1',
      targetStartUs: 5 * SECOND,
    });
    const placed = starts(plan);
    expect(placed.v1).toEqual({ trackId: 'V1', startUs: 3 * SECOND });
    // The partner follows by the same delta and stays on its own lane.
    expect(placed.a1).toEqual({ trackId: 'A1', startUs: 3 * SECOND });
    expect(placed.v2).toEqual({ trackId: 'V1', startUs: 0 });
  });

  it('carries the audio of clips that only moved because of the repack', () => {
    // The regression this pins: only the dragged clip used to carry its
    // partner, so repacking pulled every other pair out of sync.
    const linked = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'v1', startUs: 0, durationUs: 2 * SECOND, linkGroupId: 'g1' },
          { id: 'v2', startUs: 2 * SECOND, durationUs: 2 * SECOND, linkGroupId: 'g2' },
          { id: 'v3', startUs: 4 * SECOND, durationUs: 2 * SECOND, linkGroupId: 'g3' },
        ],
      },
      A1: {
        kind: 'audio',
        items: [
          { id: 'a1', startUs: 0, durationUs: 2 * SECOND, linkGroupId: 'g1' },
          { id: 'a2', startUs: 2 * SECOND, durationUs: 2 * SECOND, linkGroupId: 'g2' },
          { id: 'a3', startUs: 4 * SECOND, durationUs: 2 * SECOND, linkGroupId: 'g3' },
        ],
      },
    });
    const plan = planTimelineMove(linked, {
      movedItemId: 'v3',
      targetTrackId: 'V1',
      targetStartUs: 0,
    });
    const placed = starts(plan);
    // v3 leads, so v1 and v2 each shift right by its length.
    expect(placed.v3?.startUs).toBe(0);
    expect(placed.v1?.startUs).toBe(2 * SECOND);
    expect(placed.v2?.startUs).toBe(4 * SECOND);
    // Each partner lands on the same frame as its video, on its own lane.
    expect(placed.a3).toEqual({ trackId: 'A1', startUs: 0 });
    expect(placed.a1).toEqual({ trackId: 'A1', startUs: 2 * SECOND });
    expect(placed.a2).toEqual({ trackId: 'A1', startUs: 4 * SECOND });
  });

  it('refuses a move that would drag a partner before zero', () => {
    const linked = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'v1', startUs: 0, durationUs: 2 * SECOND },
          { id: 'v2', startUs: 2 * SECOND, durationUs: 2 * SECOND, linkGroupId: 'g' },
        ],
      },
      A1: {
        kind: 'audio',
        // The partner already sits earlier than its video, so packing v2 to the
        // front would push it below zero.
        items: [{ id: 'a2', startUs: SECOND, durationUs: 2 * SECOND, linkGroupId: 'g' }],
      },
    });
    expect(
      planTimelineMove(linked, { movedItemId: 'v2', targetTrackId: 'V1', targetStartUs: 0 }),
    ).toBeUndefined();
  });
});

describe('planTimelineMove reorders within a free track', () => {
  const audio = () =>
    project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [{ id: 'v', startUs: 0, durationUs: SECOND }],
      },
      A1: {
        kind: 'audio',
        items: [
          { id: 'm1', startUs: 0, durationUs: 2 * SECOND },
          { id: 'm2', startUs: 4 * SECOND, durationUs: 3 * SECOND },
        ],
      },
    });

  it('trades places with the clip it is dropped onto', () => {
    const plan = planTimelineMove(audio(), {
      movedItemId: 'm1',
      targetTrackId: 'A1',
      targetStartUs: 5 * SECOND,
    });
    const placed = starts(plan);
    // Seated back to back from the earlier in-point, so unequal lengths cannot
    // leave them overlapping.
    expect(placed.m2).toEqual({ trackId: 'A1', startUs: 0 });
    expect(placed.m1).toEqual({ trackId: 'A1', startUs: 3 * SECOND });
  });

  it('moves a clip ahead of one sitting at the very start of the track', () => {
    // The regression this pins. Centre against centre needed the two clips to
    // sit exactly on top of each other, and with the left one anchored at zero
    // the drag clamps before that can happen, so the exchange was unreachable.
    const atZero = () =>
      project({
        V1: {
          kind: 'visual',
          role: 'storyline',
          items: [{ id: 'v', startUs: 0, durationUs: SECOND }],
        },
        A1: {
          kind: 'audio',
          items: [
            { id: 'first', startUs: 0, durationUs: 2 * SECOND },
            { id: 'second', startUs: 2 * SECOND, durationUs: 2 * SECOND },
          ],
        },
      });

    // Half way over `first` is enough; it does not have to reach zero.
    const halfway = starts(
      planTimelineMove(atZero(), {
        movedItemId: 'second',
        targetTrackId: 'A1',
        targetStartUs: 900_000,
      }),
    );
    expect(halfway.second?.startUs).toBe(0);
    expect(halfway.first?.startUs).toBe(2 * SECOND);

    // And not before that: still pushing in, so it holds its own slot, which
    // the plan reports as nothing to place.
    const notYet = planTimelineMove(atZero(), {
      movedItemId: 'second',
      targetTrackId: 'A1',
      targetStartUs: SECOND + 500_000,
    });
    expect(starts(notYet)).toEqual({});
    expect(notYet?.ghost.startUs).toBe(2 * SECOND);
  });

  it('exchanges two equal, adjacent clips in either direction', () => {
    // The regression this pins. Equal lengths make the two centres coincide
    // exactly at the moment of the drop, and snapping lands the drag right
    // there, so this is the ordinary case rather than an edge one.
    const pair = () =>
      project({
        V1: {
          kind: 'visual',
          role: 'storyline',
          items: [{ id: 'v', startUs: 0, durationUs: SECOND }],
        },
        A1: {
          kind: 'audio',
          items: [
            { id: 'p', startUs: 0, durationUs: 2 * SECOND },
            { id: 'q', startUs: 2 * SECOND, durationUs: 2 * SECOND },
          ],
        },
      });

    const rightward = starts(
      planTimelineMove(pair(), {
        movedItemId: 'p',
        targetTrackId: 'A1',
        targetStartUs: 2 * SECOND,
      }),
    );
    expect(rightward.q?.startUs).toBe(0);
    expect(rightward.p?.startUs).toBe(2 * SECOND);

    const leftward = starts(
      planTimelineMove(pair(), { movedItemId: 'q', targetTrackId: 'A1', targetStartUs: 0 }),
    );
    expect(leftward.q?.startUs).toBe(0);
    expect(leftward.p?.startUs).toBe(2 * SECOND);
  });

  it('keeps shoving past further clips within the same gesture', () => {
    // Three back to back takes; the last one is pushed to the front without
    // letting go. Each plan is resolved from the committed layout, so passing
    // a second midpoint simply moves further rather than needing a new gesture.
    const run = () =>
      project({
        V1: {
          kind: 'visual',
          role: 'storyline',
          items: [{ id: 'v', startUs: 0, durationUs: SECOND }],
        },
        A1: {
          kind: 'audio',
          items: [
            { id: 'x', startUs: 0, durationUs: 2 * SECOND },
            { id: 'y', startUs: 2 * SECOND, durationUs: 2 * SECOND },
            { id: 'z', startUs: 4 * SECOND, durationUs: 2 * SECOND },
          ],
        },
      });

    // Far enough left to pass y, but not x.
    const onePlace = starts(
      planTimelineMove(run(), { movedItemId: 'z', targetTrackId: 'A1', targetStartUs: 2 * SECOND }),
    );
    expect(onePlace.z?.startUs).toBe(2 * SECOND);
    expect(onePlace.y?.startUs).toBe(4 * SECOND);
    expect(onePlace.x).toBeUndefined();

    // Keep going in the same drag: now past x as well.
    const twoPlaces = starts(
      planTimelineMove(run(), { movedItemId: 'z', targetTrackId: 'A1', targetStartUs: 0 }),
    );
    expect(twoPlaces.z?.startUs).toBe(0);
    expect(twoPlaces.x?.startUs).toBe(2 * SECOND);
    expect(twoPlaces.y?.startUs).toBe(4 * SECOND);
  });

  it('leaves the other clip alone for a drop that misses it', () => {
    const plan = planTimelineMove(audio(), {
      movedItemId: 'm1',
      targetTrackId: 'A1',
      targetStartUs: 8 * SECOND,
    });
    expect(starts(plan)).toEqual({ m1: { trackId: 'A1', startUs: 8 * SECOND } });
  });

  it('holds the clip in its own slot for a graze too small to count', () => {
    // m1 would cover 2.5s..4.5s, so its leading edge reaches 4.5s and m2's
    // midpoint is 5.5s: pushing into m2, but not yet past it. The clip stays
    // where it belongs rather than the drop being refused, so the half of a
    // neighbour a drag has to cross is not a dead band. Staying put is a plan
    // with nothing in it, and a ghost drawn back at the clip's own start.
    const plan = planTimelineMove(audio(), {
      movedItemId: 'm1',
      targetTrackId: 'A1',
      targetStartUs: 2 * SECOND + 500_000,
    });
    expect(starts(plan)).toEqual({});
    expect(plan?.ghost).toEqual({ trackId: 'A1', startUs: 0 });
    expect(placementsChange(audio(), plan?.placements ?? new Map())).toBe(false);
  });
});

describe('occupancy decides whether a layout may stack', () => {
  // A filler clip between two takes, with audio that runs longer than the video
  // it belongs to. Dragging the last take to the front packs the storyline, and
  // both pairs travel with it -- but their audio keeps its own lengths, so a2
  // (eight seconds) ends up covering the ground a1 was pushed into. Packing the
  // video says nothing about the lengths below it.
  //
  // Both partners stay at or after zero, so nothing here is refused for
  // leaving the timeline: occupancy is the only thing deciding the outcome.
  const uneven = (occupancy: 'exclusive' | 'free') =>
    project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'v1', startUs: 0, durationUs: 3 * SECOND, linkGroupId: 'g1' },
          { id: 'filler', startUs: 3 * SECOND, durationUs: 5 * SECOND },
          { id: 'v2', startUs: 8 * SECOND, durationUs: 4 * SECOND, linkGroupId: 'g2' },
        ],
      },
      A1: {
        kind: 'audio',
        occupancy,
        items: [
          { id: 'a1', startUs: 0, durationUs: 3 * SECOND, linkGroupId: 'g1' },
          // Audio runs well past the video cut it belongs to.
          { id: 'a2', startUs: 8 * SECOND, durationUs: 8 * SECOND, linkGroupId: 'g2' },
        ],
      },
    });

  it('refuses the move when the audio Track forbids overlap', () => {
    expect(
      planTimelineMove(uneven('exclusive'), {
        movedItemId: 'v2',
        targetTrackId: 'V1',
        targetStartUs: 0,
      }),
    ).toBeUndefined();
  });

  it('allows the same move when the audio Track permits stacking', () => {
    const plan = planTimelineMove(uneven('free'), {
      movedItemId: 'v2',
      targetTrackId: 'V1',
      targetStartUs: 0,
    });
    expect(starts(plan).v2?.startUs).toBe(0);
  });

  it('allows the move with links off, because the audio simply stays put', () => {
    const plan = planTimelineMove(uneven('exclusive'), {
      movedItemId: 'v2',
      targetTrackId: 'V1',
      targetStartUs: 0,
      followLinks: false,
    });
    expect(starts(plan).v2?.startUs).toBe(0);
  });

  it('ignores an overlap that already exists on a Track the plan never touches', () => {
    const messy = project({
      V1: {
        kind: 'visual',
        role: 'storyline',
        items: [
          { id: 'a', startUs: 0, durationUs: 2 * SECOND },
          { id: 'b', startUs: 2 * SECOND, durationUs: 2 * SECOND },
        ],
      },
      A1: {
        kind: 'audio',
        occupancy: 'exclusive',
        items: [
          { id: 'x', startUs: 0, durationUs: 5 * SECOND },
          { id: 'y', startUs: SECOND, durationUs: 5 * SECOND },
        ],
      },
    });
    // The plan only reseats `b` on V1, clear of `a`. A1 already stacks, but no
    // placement names it, so it is none of this move's business.
    expect(violatesOccupancy(messy, new Map([['b', { trackId: 'V1', startUs: 6 * SECOND }]]))).toBe(
      false,
    );
  });

  it('detects a third Item hidden under a longer transitioned Item', () => {
    const nested = project({
      V1: {
        kind: 'visual',
        occupancy: 'exclusive',
        items: [
          { id: 'long', startUs: 0, durationUs: 10 * SECOND },
          { id: 'transitioned', startUs: SECOND, durationUs: SECOND },
          { id: 'hidden', startUs: 3 * SECOND, durationUs: SECOND },
        ],
      },
    });
    (nested.transitions as Record<string, unknown>).allowed = {
      fromItemId: 'long',
      toItemId: 'transitioned',
    };
    expect(
      violatesOccupancy(nested, new Map([['hidden', { trackId: 'V1', startUs: 3 * SECOND }]])),
    ).toBe(true);
  });
});
