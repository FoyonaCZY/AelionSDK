import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelionsdk/core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  asKnownItem,
  canonicalClone,
  isAudioItem,
  isGapItem,
  isTimedMediaItem,
  isVideoItem,
  itemMediaSource,
  itemSourceRange,
  itemVisual,
  ProjectValidator,
  trackOccupancy,
  trackRole,
  type AelionProject,
  type ItemEntity,
  type TrackEntity,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);
let fixture: JsonObject;
let validator: ProjectValidator;

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

beforeAll(async () => {
  const [projectSchema, materialInstanceSchema, example] = await Promise.all([
    readJson('schemas/project/v2.0/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
    readJson('examples/aelion-project-v1.example.json'),
  ]);
  validator = new ProjectValidator({ projectSchema, materialInstanceSchema });
  fixture = example;
});

function loaded(mutate: (project: JsonObject) => void = () => undefined): AelionProject {
  const candidate = canonicalClone(fixture);
  mutate(candidate);
  const result = validator.validate(candidate);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value.project;
}

function item(project: AelionProject, id: string): ItemEntity {
  const value = project.items[id];
  if (value === undefined) throw new Error(`Fixture Item ${id} is missing`);
  return value;
}

function track(project: AelionProject, id: string): TrackEntity {
  const value = project.tracks[id];
  if (value === undefined) throw new Error(`Fixture Track ${id} is missing`);
  return value;
}

function diagnosticsOf(mutate: (project: JsonObject) => void): readonly { code: string }[] {
  const candidate = canonicalClone(fixture);
  mutate(candidate);
  const result = validator.validate(candidate);
  return result.ok ? [] : result.diagnostics;
}

describe('Track role and occupancy', () => {
  it('defaults a Track without the fields to a freely positioned overlay', () => {
    const project = loaded();
    const title = track(project, 'track_title');
    expect(trackRole(title)).toBe('overlay');
    expect(trackOccupancy(title)).toBe('free');
  });

  it('makes a storyline exclusive unless it says otherwise', () => {
    const storyline = { kind: 'visual', role: 'storyline' } as unknown as TrackEntity;
    expect(trackOccupancy(storyline)).toBe('exclusive');
    const relaxed = { ...storyline, occupancy: 'free' } as unknown as TrackEntity;
    expect(trackOccupancy(relaxed)).toBe('free');
  });

  it('accepts the declared fields through the schema', () => {
    const project = loaded(candidate => {
      const tracks = candidate.tracks as JsonObject;
      const track = tracks.track_video_main as JsonObject;
      track.role = 'storyline';
      track.occupancy = 'exclusive';
    });
    expect(trackRole(track(project, 'track_video_main'))).toBe('storyline');
  });

  it('rejects an ambiguous Sequence with more than one storyline', () => {
    const codes = diagnosticsOf(candidate => {
      const tracks = candidate.tracks as JsonObject;
      (tracks.track_video_main as JsonObject).role = 'storyline';
      (tracks.track_title as JsonObject).role = 'storyline';
    }).map(diagnostic => diagnostic.code);
    expect(codes).toContain('PROJECT_MULTIPLE_STORYLINE_TRACKS');
  });

  it('rejects stacked Items on an exclusive Track', () => {
    const codes = diagnosticsOf(candidate => {
      const tracks = candidate.tracks as JsonObject;
      (tracks.track_title as JsonObject).occupancy = 'exclusive';
      const items = candidate.items as JsonObject;
      // A second Item on that lane, landing on top of item_title.
      items.item_title_two = {
        ...canonicalClone(items.item_title as JsonObject),
        id: 'item_title_two',
        range: { startUs: 1_000_000, durationUs: 2_000_000 },
      };
      (tracks.track_title as JsonObject).itemIds = ['item_title', 'item_title_two'];
    }).map(diagnostic => diagnostic.code);
    expect(codes).toContain('PROJECT_TRACK_OCCUPANCY_OVERLAP');
  });

  it('permits the overlap a Transition is made of', () => {
    // The two takes in the fixture overlap by their cross dissolve. Declaring
    // that lane exclusive must not turn a dissolve into a schema error.
    const codes = diagnosticsOf(candidate => {
      const track = (candidate.tracks as JsonObject).track_video_main as JsonObject;
      track.role = 'storyline';
    }).map(diagnostic => diagnostic.code);
    expect(codes).not.toContain('PROJECT_TRACK_OCCUPANCY_OVERLAP');
  });

  it('still rejects a third Item hidden under a longer transitioned Item', () => {
    const codes = diagnosticsOf(candidate => {
      const track = (candidate.tracks as JsonObject).track_video_main as JsonObject;
      track.role = 'storyline';
      const items = candidate.items as JsonObject;
      const hidden = canonicalClone(items.item_video_a as JsonObject);
      hidden.id = 'item_hidden_overlap';
      hidden.range = { startUs: 1_000_000, durationUs: 100_000 };
      delete hidden.linkGroupId;
      items.item_hidden_overlap = hidden;
      track.itemIds = [...(track.itemIds as string[]), 'item_hidden_overlap'];
    }).map(diagnostic => diagnostic.code);
    expect(codes).toContain('PROJECT_TRACK_OCCUPANCY_OVERLAP');
  });

  it('leaves overlap legal on a Track that does not declare exclusivity', () => {
    const codes = diagnosticsOf(candidate => {
      const items = candidate.items as JsonObject;
      items.item_music_two = {
        ...canonicalClone(items.item_music as JsonObject),
        id: 'item_music_two',
        range: { startUs: 0, durationUs: 5_000_000 },
      };
      ((candidate.tracks as JsonObject).track_music as JsonObject).itemIds = [
        'item_music',
        'item_music_two',
      ];
    }).map(diagnostic => diagnostic.code);
    expect(codes).not.toContain('PROJECT_TRACK_OCCUPANCY_OVERLAP');
  });
});

describe('Gap Items', () => {
  function withGap(candidate: JsonObject): void {
    const items = candidate.items as JsonObject;
    items.item_pause = {
      id: 'item_pause',
      trackId: 'track_title',
      type: 'gap',
      enabled: true,
      range: { startUs: 6_000_000, durationUs: 2_000_000 },
      materialInstanceIds: [],
    };
    ((candidate.tracks as JsonObject).track_title as JsonObject).itemIds = [
      'item_title',
      'item_pause',
    ];
  }

  it('validates as an ordinary Item', () => {
    const project = loaded(withGap);
    const gap = item(project, 'item_pause');
    expect(isGapItem(gap)).toBe(true);
    expect(asKnownItem(gap)?.type).toBe('gap');
  });

  it('carries no visual or source, because it renders nothing', () => {
    const gap = item(loaded(withGap), 'item_pause');
    expect(itemVisual(gap)).toBeUndefined();
    expect(itemMediaSource(gap)).toBeUndefined();
  });

  it('may sit on an audio Track, unlike every other Item type', () => {
    const codes = diagnosticsOf(candidate => {
      const items = candidate.items as JsonObject;
      items.item_silence = {
        id: 'item_silence',
        trackId: 'track_music',
        type: 'gap',
        enabled: true,
        range: { startUs: 11_000_000, durationUs: 2_000_000 },
        materialInstanceIds: [],
      };
      ((candidate.tracks as JsonObject).track_music as JsonObject).itemIds = [
        'item_music',
        'item_silence',
      ];
    });
    expect(codes).toHaveLength(0);
  });
});

describe('Item type narrowing', () => {
  it('discriminates on the type the schema already closed over', () => {
    const project = loaded();
    const video = item(project, 'item_video_a');
    const audio = item(project, 'item_audio_a');
    expect(isVideoItem(video)).toBe(true);
    expect(isAudioItem(video)).toBe(false);
    expect(isTimedMediaItem(audio)).toBe(true);
    expect(isTimedMediaItem(item(project, 'item_title'))).toBe(false);
  });

  it('reaches source and visual without a cast', () => {
    const project = loaded();
    const video = item(project, 'item_video_a');
    if (!isVideoItem(video)) throw new Error('fixture changed');
    // Reading these off the narrowed type is the point: no `as JsonObject`.
    expect(typeof video.source.assetId).toBe('string');
    expect(video.visual.blendMode).toBe('normal');
    expect(itemSourceRange(video)?.durationUs).toBeGreaterThan(0);
  });

  it('returns undefined for a type it does not recognise', () => {
    expect(asKnownItem({ type: 'hologram' } as unknown as ItemEntity)).toBeUndefined();
  });
});
