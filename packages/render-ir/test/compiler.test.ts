import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelion/core';
import type { AelionProject } from '@aelion/project-schema';
import { ProjectValidator } from '@aelion/project-schema';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  evaluateAudioState,
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
    expect(compilation.stats.compiledClips).toBe(5);
    const firstVisual = compilation.ir.tracks
      .flatMap(track => track.clips)
      .find(clip => clip.kind === 'visual-clip');
    if (firstVisual?.kind !== 'visual-clip') throw new Error('Visual clip is missing');
    expect(firstVisual.visual).toMatchObject({ opacity: 1, blendMode: 'normal' });
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

    expect(first.stats.compiledClips).toBe(5);
    expect(second.stats.compiledClips).toBe(0);
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

    expect(next.stats.compiledClips).toBe(5);
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
    expect(revisionTwo.stats.reusedClips).toBe(5);
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
    expect(next.stats.reusedClips).toBe(5);
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
    expect(next.stats.reusedClips).toBe(5);
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
      reusedClips: 4,
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
});
