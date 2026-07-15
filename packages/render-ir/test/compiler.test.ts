import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelion/core';
import type { AelionProject, ItemEntity } from '@aelion/project-schema';
import { ProjectValidator } from '@aelion/project-schema';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  evaluateAudioState,
  evaluateAnimatedValue,
  evaluateMaterialInstance,
  evaluateVisualState,
  IncrementalRenderCompiler,
  mapClipSourceTime,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);
let project: AelionProject;

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

beforeAll(async () => {
  const [projectSchema, materialSchema, fixture] = await Promise.all([
    readJson('schemas/project/v1/project.schema.json'),
    readJson('schemas/material/v1/instance.schema.json'),
    readJson('examples/aelion-project-v1.example.json'),
  ]);
  const result = new ProjectValidator({
    projectSchema,
    materialInstanceSchema: materialSchema,
  }).validate(fixture);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  project = result.value.project;
});

describe('Project to Render IR', () => {
  it('compiles normalized Project entities into versioned IR', () => {
    const compilation = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n);
    expect(compilation.ir).toMatchObject({
      irVersion: '1.0.0',
      sequenceId: 'seq_main',
      width: 1920,
      height: 1080,
      durationUs: 10_000_000,
    });
    expect(compilation.ir.tracks).toHaveLength(4);
    expect(compilation.ir.transitions).toHaveLength(1);
    expect(Object.keys(compilation.ir.materials)).toHaveLength(3);
    expect(compilation.stats.compiledClips).toBe(6);
    const firstVisual = compilation.ir.tracks
      .flatMap(track => track.clips)
      .find(clip => clip.kind === 'visual-clip');
    if (firstVisual?.kind !== 'visual-clip') throw new Error('Visual clip is missing');
    expect(firstVisual.visual).toMatchObject({ opacity: 1, blendMode: 'normal' });
    const title = compilation.ir.tracks
      .flatMap(track => track.clips)
      .find(clip => clip.kind === 'text-clip');
    expect(title).toMatchObject({ kind: 'text-clip', role: 'text', overflow: 'auto-fit' });
  });

  it('deep-freezes Render IR and compile stats at the compiler boundary', () => {
    const compilation = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n, {
      affectedRanges: [{ sequenceId: 'seq_main', startUs: 0, durationUs: 1_000_000 }],
    });
    const firstTrack = compilation.ir.tracks[0];
    const firstClip = firstTrack?.clips[0];
    expect(Object.isFrozen(compilation.ir)).toBe(true);
    expect(Object.isFrozen(compilation.ir.tracks)).toBe(true);
    expect(Object.isFrozen(firstTrack)).toBe(true);
    expect(Object.isFrozen(firstClip)).toBe(true);
    expect(Object.isFrozen(compilation.ir.materials)).toBe(true);
    expect(Object.isFrozen(compilation.stats)).toBe(true);
    expect(Object.isFrozen(compilation.stats.affectedRanges)).toBe(true);
    expect(Object.isFrozen(compilation.stats.affectedRanges[0])).toBe(true);
    expect(Reflect.set(compilation.ir, 'durationUs', 1)).toBe(false);
    expect(compilation.ir.durationUs).toBe(10_000_000);
  });

  it('reuses unchanged clips and transitions across revisions', () => {
    const compiler = new IncrementalRenderCompiler();
    const first = compiler.compile(project, 'seq_main', 0n);
    const changed = structuredClone(project);
    const title = changed.items.item_title;
    if (title === undefined) throw new Error('Fixture title is missing');
    title.name = 'Updated title metadata';
    const second = compiler.compile(changed, 'seq_main', 1n, {
      affectedRanges: [{ sequenceId: 'seq_main', startUs: 900_000, durationUs: 3_000_000 }],
      affectedEntityIds: ['item_title'],
    });

    expect(first.stats.compiledClips).toBe(6);
    expect(second.stats.compiledClips).toBe(1);
    expect(second.stats.reusedClips).toBe(5);
    expect(second.stats.reusedTransitions).toBe(1);
    expect(second.stats.affectedRanges).toHaveLength(1);
  });

  it('drops its retained incremental baseline when cleared', () => {
    const compiler = new IncrementalRenderCompiler();
    compiler.compile(project, 'seq_main', 0n);
    compiler.clear();
    const next = compiler.compile(project, 'seq_main', 1n, {
      affectedEntityIds: [],
      affectedRanges: [],
    });

    expect(next.stats.compiledClips).toBe(6);
    expect(next.stats.reusedClips).toBe(0);
    expect(next.stats.compiledTransitions).toBe(1);
    expect(next.stats.reusedTransitions).toBe(0);
  });

  it('forks an immutable incremental baseline without advancing its parent', () => {
    const parent = new IncrementalRenderCompiler();
    const initial = parent.compile(project, 'seq_main', 0n);
    const changed = structuredClone(project);
    const title = changed.items.item_title;
    if (title === undefined) throw new Error('Fixture title is missing');
    title.name = 'Fork-only metadata';

    const discarded = parent.fork().compile(changed, 'seq_main', 1n, {
      affectedEntityIds: ['item_title'],
    });
    expect(discarded.stats.reusedClips).toBe(5);
    const promoted = parent.fork();
    const revisionOne = promoted.compile(changed, 'seq_main', 1n, {
      affectedEntityIds: ['item_title'],
    });
    const revisionTwo = promoted.fork().compile(changed, 'seq_main', 2n, {
      affectedEntityIds: [],
    });

    expect(initial.ir.revision).toBe(0n);
    expect(revisionOne.stats.reusedClips).toBe(5);
    expect(revisionTwo.stats.reusedClips).toBe(6);
    expect(revisionTwo.ir.tracks[0]?.clips[0]).toBe(revisionOne.ir.tracks[0]?.clips[0]);
    const parentRevisionOne = parent.compile(changed, 'seq_main', 1n, {
      affectedEntityIds: ['item_title'],
    });
    expect(parentRevisionOne.stats.reusedClips).toBe(5);
  });

  it('rejects resolver reentrancy without corrupting the compiler baseline', () => {
    const compiler = new IncrementalRenderCompiler();
    const initial = compiler.compile(project, 'seq_main', 0n);
    let nestedError: unknown;
    expect(() =>
      compiler.compile(project, 'seq_main', 1n, {
        resolveMaterialProgram: () => {
          try {
            compiler.compile(project, 'seq_main', 99n);
          } catch (error) {
            nestedError = error;
          }
          throw new Error('resolver failed after nested compile');
        },
      }),
    ).toThrow('resolver failed');
    expect(nestedError).toBeInstanceOf(Error);
    expect(String(nestedError)).toContain('reentrant');
    const next = compiler.compile(project, 'seq_main', 1n, { affectedEntityIds: [] });
    expect(initial.ir.revision).toBe(0n);
    expect(next.stats.reusedClips).toBe(6);
  });

  it('rejects resolver-time clearing without corrupting the compiler baseline', () => {
    const compiler = new IncrementalRenderCompiler();
    const initial = compiler.compile(project, 'seq_main', 0n);
    let clearError: unknown;
    expect(() =>
      compiler.compile(project, 'seq_main', 1n, {
        resolveMaterialProgram: () => {
          try {
            compiler.clear();
          } catch (error) {
            clearError = error;
          }
          throw new Error('resolver failed after clear');
        },
      }),
    ).toThrow('resolver failed after clear');
    expect(clearError).toBeInstanceOf(Error);
    expect(String(clearError)).toContain('clearing during compilation');
    const next = compiler.compile(project, 'seq_main', 1n, { affectedEntityIds: [] });
    expect(initial.ir.revision).toBe(0n);
    expect(next.stats.reusedClips).toBe(6);
  });

  it('recompiles only dependencies named by a committed ChangeSet', () => {
    const compiler = new IncrementalRenderCompiler();
    compiler.compile(project, 'seq_main', 0n);
    const changed = structuredClone(project);
    const material = changed.materialInstances.mat_warm_film;
    if (material === undefined) throw new Error('Fixture Material is missing');
    material.parameters.intensity = 0.9;
    const compilation = compiler.compile(changed, 'seq_main', 1n, {
      affectedEntityIds: ['mat_warm_film'],
      affectedRanges: [{ sequenceId: 'seq_main', startUs: 0, durationUs: 5_200_000 }],
    });
    expect(compilation.stats).toMatchObject({
      compiledClips: 1,
      reusedClips: 5,
      compiledTransitions: 0,
      reusedTransitions: 1,
    });
  });

  it('maps linear source time and evaluates transition progress', () => {
    const ir = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n).ir;
    const state = evaluateVisualState(ir, 5_000_000);
    expect(state.clips.map(value => value.clip.id)).toEqual(['item_video_a', 'item_video_b']);
    expect(state.clips.map(value => value.sourceTimeUs)).toEqual([6_000_000, 200_000]);
    expect(state.transition?.progress).toBe(0.5);
    expect(state.transition?.material.definition.materialId).toBe('cross-dissolve');
    expect(state.clips[0]?.materials[0]?.definition.materialId).toBe('warm-film');
  });

  it('respects source boundary policies', () => {
    const ir = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n).ir;
    const clip = ir.tracks
      .flatMap(track => track.clips)
      .find(value => value.kind === 'visual-clip');
    if (clip?.kind !== 'visual-clip') throw new Error('Fixture visual clip is missing');
    expect(mapClipSourceTime(clip, clip.range.startUs)).toBe(1_000_000);
    expect(mapClipSourceTime(clip, clip.range.startUs - 1)).toBeNull();
  });

  it('compiles and evaluates Project curve TimeMaps with hold and reverse segments', () => {
    const changed = structuredClone(project);
    const item = changed.items.item_video_a;
    if (item === undefined) throw new Error('Fixture visual clip is missing');
    item.source = {
      ...(item.source as JsonObject),
      timeMapping: {
        type: 'curve',
        boundary: 'error',
        points: [
          { itemTimeUs: 0, sourceTimeUs: 1_000_000, interpolation: 'linear' },
          { itemTimeUs: 2_000_000, sourceTimeUs: 3_000_000, interpolation: 'hold' },
          { itemTimeUs: 3_000_000, sourceTimeUs: 3_000_000, interpolation: 'linear' },
          { itemTimeUs: 5_200_000, sourceTimeUs: 1_000_000, interpolation: 'linear' },
        ],
      },
    };

    const compiled = new IncrementalRenderCompiler().compile(changed, 'seq_main', 0n).ir;
    const clip = compiled.tracks
      .flatMap(track => track.clips)
      .find(value => value.id === 'item_video_a');
    if (clip?.kind !== 'visual-clip') throw new Error('Compiled visual clip is missing');
    expect(clip.source.timeMapping?.type).toBe('curve');
    expect(mapClipSourceTime(clip, 1_000_000)).toBe(2_000_000);
    expect(mapClipSourceTime(clip, 2_500_000)).toBe(3_000_000);
    expect(mapClipSourceTime(clip, 4_100_000)).toBe(2_000_000);
  });

  it('evaluates audio clips from the same Render IR time base', () => {
    const ir = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n).ir;
    const state = evaluateAudioState(ir, 5_000_000, 100_000);
    expect(state.clips.map(value => value.clip.id)).toEqual([
      'item_audio_a',
      'item_audio_b',
      'item_music',
    ]);
    expect(state.clips.map(value => value.sourceStartUs)).toEqual([6_000_000, 200_000, 5_000_000]);
  });

  it('carries track mixer state into Render IR and excludes muted tracks', () => {
    const changed = structuredClone(project);
    const musicTrack = changed.tracks.track_music;
    if (musicTrack === undefined) throw new Error('Fixture music track is missing');
    musicTrack.audio = { gainDb: -3, pan: 0.25, muted: true };

    const ir = new IncrementalRenderCompiler().compile(changed, 'seq_main', 0n).ir;
    expect(ir.tracks.find(track => track.id === 'track_music')?.audio).toEqual({
      gainDb: -3,
      pan: 0.25,
      muted: true,
    });
    expect(evaluateAudioState(ir, 5_000_000, 100_000).clips.map(value => value.clip.id)).toEqual([
      'item_audio_a',
      'item_audio_b',
    ]);
  });

  it('mixes only enabled solo audio Tracks when solo mode is active', () => {
    const changed = structuredClone(project);
    const musicTrack = changed.tracks.track_music;
    if (musicTrack?.audio === undefined) throw new Error('Fixture music track is missing');
    musicTrack.audio.solo = true;

    const compiler = new IncrementalRenderCompiler();
    const solo = compiler.compile(changed, 'seq_main', 0n).ir;
    expect(evaluateAudioState(solo, 5_000_000, 100_000).clips.map(value => value.clip.id)).toEqual([
      'item_music',
    ]);

    musicTrack.enabled = false;
    const disabledSolo = compiler.compile(changed, 'seq_main', 1n).ir;
    expect(
      evaluateAudioState(disabledSolo, 5_000_000, 100_000).clips.map(value => value.clip.id),
    ).toEqual(['item_audio_a', 'item_audio_b']);

    const muted = structuredClone(project);
    const mutedMusicTrack = muted.tracks.track_music;
    if (mutedMusicTrack?.audio === undefined) throw new Error('Fixture music track is missing');
    mutedMusicTrack.audio.solo = true;
    mutedMusicTrack.audio.muted = true;
    const mutedSolo = compiler.compile(muted, 'seq_main', 2n).ir;
    expect(evaluateAudioState(mutedSolo, 5_000_000, 100_000).clips).toEqual([]);
  });

  it('evaluates Material numeric keyframes and preserves resource/input bindings', () => {
    const ir = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n).ir;
    const material = ir.materials.mat_warm_film;
    if (material === undefined) throw new Error('Material is missing');
    const animated = {
      ...material,
      parameters: {
        intensity: {
          animation: {
            keyframes: [
              { timeUs: 0, value: 0, interpolation: 'linear' },
              { timeUs: 1_000_000, value: 1, interpolation: 'linear' },
            ],
          },
        },
      },
      resourceBindings: { lut: { assetId: 'asset_lut' } },
      inputBindings: { source: { host: 'source' } },
    };
    expect(evaluateMaterialInstance(animated, 500_000)).toMatchObject({
      parameters: { intensity: 0.5 },
      resourceBindings: { lut: { assetId: 'asset_lut' } },
      inputBindings: { source: { host: 'source' } },
    });
  });

  it('honors sequence-time cubic-bezier Material automation', () => {
    const ir = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n).ir;
    const material = ir.materials.mat_warm_film;
    if (material === undefined) throw new Error('Material is missing');
    const animated = {
      ...material,
      parameters: {
        intensity: {
          animation: {
            timeSpace: 'sequence',
            preInfinity: 'hold',
            postInfinity: 'hold',
            keyframes: [
              {
                timeUs: 1_000_000,
                value: 0,
                interpolation: 'cubic-bezier',
                easing: { type: 'cubic-bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 },
              },
              { timeUs: 2_000_000, value: 1, interpolation: 'linear' },
            ],
          },
        },
      },
    };
    const quarter = evaluateMaterialInstance(animated, 1_250_000, 1_000_000);
    expect(quarter.parameters.intensity).toEqual(expect.any(Number));
    expect(quarter.parameters.intensity as number).toBeLessThan(0.25);
    expect(evaluateMaterialInstance(animated, 500_000, 1_000_000).parameters.intensity).toBe(0);
    expect(evaluateMaterialInstance(animated, 2_500_000, 1_000_000).parameters.intensity).toBe(1);
  });

  it('interpolates vector objects, steps and looping infinity modes deterministically', () => {
    const vector = {
      animation: {
        timeSpace: 'item',
        preInfinity: 'hold',
        postInfinity: 'ping-pong',
        keyframes: [
          {
            timeUs: 0,
            value: { x: 0, y: 10 },
            interpolation: 'linear',
            easing: { type: 'steps', count: 4, position: 'end' },
          },
          { timeUs: 1_000, value: { x: 100, y: 30 }, interpolation: 'linear' },
        ],
      },
    } as unknown as JsonObject;
    expect(evaluateAnimatedValue(vector, 300)).toEqual({ x: 25, y: 15 });
    expect(evaluateAnimatedValue(vector, 1_250)).toEqual({ x: 75, y: 25 });

    const cycle = {
      animation: {
        ...(vector.animation as JsonObject),
        postInfinity: 'cycle',
      },
    } as JsonObject;
    expect(evaluateAnimatedValue(cycle, 1_250)).toEqual({ x: 25, y: 15 });
  });

  it('compiles nested Sequences as immutable subgraphs with shared TimeMap semantics', () => {
    const changed = structuredClone(project);
    const main = changed.sequences.seq_main;
    const titleTrack = changed.tracks.track_title;
    const title = changed.items.item_title;
    if (main === undefined || titleTrack === undefined || title === undefined) {
      throw new Error('Fixture title is missing');
    }
    changed.sequences.seq_child = {
      ...structuredClone(main),
      id: 'seq_child',
      trackIds: ['track_child'],
      transitionIds: [],
      materialInstanceIds: [],
      markerIds: [],
      duration: { mode: 'fixed', durationUs: 2_000_000, overflow: 'clip' },
    };
    changed.tracks.track_child = {
      ...structuredClone(titleTrack),
      id: 'track_child',
      sequenceId: 'seq_child',
      itemIds: ['item_child_title'],
    };
    changed.items.item_child_title = {
      ...structuredClone(title),
      id: 'item_child_title',
      trackId: 'track_child',
      range: { startUs: 0, durationUs: 2_000_000 },
    };
    changed.items.item_nested = {
      ...structuredClone(title),
      id: 'item_nested',
      trackId: 'track_title',
      type: 'nested-sequence',
      range: { startUs: 4_000_000, durationUs: 1_000_000 },
      source: {
        sequenceId: 'seq_child',
        sourceRange: { startUs: 0, durationUs: 2_000_000 },
        timeMapping: {
          type: 'linear',
          rate: { numerator: 2, denominator: 1 },
          reverse: false,
          boundary: 'error',
        },
      },
    };
    titleTrack.itemIds.push('item_nested');

    const ir = new IncrementalRenderCompiler().compile(changed, 'seq_main', 3n).ir;
    expect(ir.subgraphs?.seq_child).toMatchObject({
      sequenceId: 'seq_child',
      durationUs: 2_000_000,
    });
    const active = evaluateVisualState(ir, 4_250_000).clips.find(
      value => value.clip.id === 'item_nested',
    );
    expect(active).toMatchObject({ sourceTimeUs: 500_000 });
  });

  it('diagnoses a recursive nested Sequence path before producing Render IR', () => {
    const changed = structuredClone(project);
    const main = changed.sequences.seq_main;
    const track = changed.tracks.track_title;
    const title = changed.items.item_title;
    if (main === undefined || track === undefined || title === undefined) {
      throw new Error('Fixture title is missing');
    }
    changed.sequences.seq_child = {
      ...structuredClone(main),
      id: 'seq_child',
      trackIds: ['track_child'],
      transitionIds: [],
      materialInstanceIds: [],
      markerIds: [],
    };
    changed.tracks.track_child = {
      ...structuredClone(track),
      id: 'track_child',
      sequenceId: 'seq_child',
      itemIds: ['nested_to_main'],
    };
    const nested = (id: string, trackId: string, sequenceId: string): ItemEntity =>
      ({
        ...structuredClone(title),
        id,
        trackId,
        type: 'nested-sequence',
        source: {
          sequenceId,
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          timeMapping: {
            type: 'linear',
            rate: { numerator: 1, denominator: 1 },
            reverse: false,
            boundary: 'error',
          },
        },
      }) as ItemEntity;
    changed.items.nested_to_child = nested('nested_to_child', 'track_title', 'seq_child');
    changed.items.nested_to_main = nested('nested_to_main', 'track_child', 'seq_main');
    track.itemIds.push('nested_to_child');
    expect(() => new IncrementalRenderCompiler().compile(changed, 'seq_main', 0n)).toThrow(
      'NESTED_SEQUENCE_CYCLE: seq_main -> seq_child -> seq_main',
    );
  });

  it('compiles image adapters, generators and adjustment layers as visual IR', () => {
    const changed = structuredClone(project);
    const visualTrack = changed.tracks.track_video_main;
    const titleTrack = changed.tracks.track_title;
    const video = changed.items.item_video_a;
    const title = changed.items.item_title;
    if (
      visualTrack === undefined ||
      titleTrack === undefined ||
      video === undefined ||
      title === undefined
    ) {
      throw new Error('Fixture visual items are missing');
    }
    changed.items.item_image = {
      ...structuredClone(video),
      id: 'item_image',
      type: 'image',
      range: { startUs: 6_000_000, durationUs: 1_000_000 },
    };
    changed.items.item_generator = {
      ...structuredClone(title),
      id: 'item_generator',
      type: 'generator',
      range: { startUs: 6_000_000, durationUs: 1_000_000 },
      generator: {
        kind: 'linear-gradient',
        colors: [
          { space: 'srgb-linear', rgba: [1, 0, 0, 1] },
          { space: 'srgb-linear', rgba: [0, 0, 1, 1] },
        ],
        angleDeg: 90,
      },
    };
    changed.items.item_adjustment = {
      ...structuredClone(title),
      id: 'item_adjustment',
      type: 'adjustment',
      range: { startUs: 6_000_000, durationUs: 1_000_000 },
      materialInstanceIds: ['mat_warm_film'],
    };
    visualTrack.itemIds.push('item_image');
    titleTrack.itemIds.push('item_generator', 'item_adjustment');
    const ir = new IncrementalRenderCompiler().compile(changed, 'seq_main', 0n).ir;
    expect(ir.tracks.flatMap(track => track.clips).map(clip => [clip.id, clip.kind])).toEqual(
      expect.arrayContaining([
        ['item_image', 'visual-clip'],
        ['item_generator', 'generator-clip'],
        ['item_adjustment', 'adjustment-clip'],
      ]),
    );
    expect(evaluateVisualState(ir, 6_500_000).clips.map(value => value.clip.id)).toEqual(
      expect.arrayContaining(['item_image', 'item_generator', 'item_adjustment']),
    );
  });
});
