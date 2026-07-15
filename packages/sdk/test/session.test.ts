import { readFile } from 'node:fs/promises';

import type { JsonObject } from '@aelion/core';
import type { WebMExportOptions } from '@aelion/export';
import { canonicalHash } from '@aelion/project-schema';
import { describe, expect, it, vi } from 'vitest';

import { Aelion, AelionSession, defaultSchemas } from '../src/index.js';
import { ExportJob } from '../src/export-job.js';

const root = new URL('../../../', import.meta.url);

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as JsonObject;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('@aelion/sdk session facade', () => {
  it('bundles the canonical v1 schemas as deeply frozen runtime data', async () => {
    const [projectSchema, materialInstanceSchema] = await Promise.all([
      json('schemas/project/v1/project.schema.json'),
      json('schemas/material/v1/instance.schema.json'),
    ]);
    expect(defaultSchemas.project).toEqual(projectSchema);
    expect(defaultSchemas.materialInstance).toEqual(materialInstanceSchema);
    expect(Object.isFrozen(defaultSchemas)).toBe(true);
    expect(Object.isFrozen(defaultSchemas.project)).toBe(true);
    expect(Object.isFrozen(defaultSchemas.project.properties)).toBe(true);
    expect(Object.isFrozen(defaultSchemas.materialInstance.properties)).toBe(true);
  });

  it('loads a Project and keeps edit, undo and redo atomic through the public API', async () => {
    const [project, projectSchema, materialInstanceSchema] = await Promise.all([
      json('examples/aelion-vertical-slice-30s.project.json'),
      json('schemas/project/v1/project.schema.json'),
      json('schemas/material/v1/instance.schema.json'),
    ]);
    const session = await Aelion.createSession({
      schemas: { project: projectSchema, materialInstance: materialInstanceSchema },
    });
    try {
      await session.loadProject(project);
      const initial = session.getSnapshot().project;
      if (initial === null) throw new Error('Project was not loaded');
      const initialHash = await canonicalHash(initial);
      const commit = session.transaction.edit(
        edit => edit.setField('items', 'item_opening', ['range', 'durationUs'], 15_000_000),
        { label: 'Trim opening' },
      );
      expect(commit.revision).toBe(1n);
      expect(session.transaction.canUndo).toBe(true);
      expect(session.getSnapshot().renderIr?.revision).toBe(1n);
      session.transaction.commands.trimItem({
        itemId: 'item_closing',
        edge: 'end',
        toUs: 29_500_000,
      });
      expect(session.revision).toBe(2n);
      session.transaction.undo();
      expect(session.revision).toBe(3n);
      session.transaction.undo();
      const restored = session.getSnapshot().project;
      if (restored === null) throw new Error('Undo removed the Project');
      await expect(canonicalHash(restored)).resolves.toBe(initialHash);
      expect(session.transaction.canRedo).toBe(true);
      session.transaction.redo();
      expect(session.revision).toBe(5n);
      expect(session.getSnapshot().renderIr?.revision).toBe(5n);
      expect(session.transaction.canRedo).toBe(true);
    } finally {
      await session.dispose();
    }
    expect(session.state).toBe('disposed');
  });

  it('keeps Project, Render IR, history and events unchanged when Material preparation fails', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    let fail = false;
    let resolverCalls = 0;
    const session = new AelionSession({
      materials: {
        resolveProgram: () => {
          resolverCalls += 1;
          if (fail) throw new Error('compile boom');
          return undefined;
        },
      },
    });
    await session.loadProject(project);
    const before = session.getSnapshot();
    if (before.project === null || before.renderIr === null)
      throw new Error('Project was not loaded');
    const beforeHash = await canonicalHash(before.project);
    const beforeCompile = session.getStats().compile;
    const events: bigint[] = [];
    session.subscribe('project-changed', event => events.push(event.commit.revision));
    fail = true;

    expect(() =>
      session.transaction.edit(edit => {
        edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.66);
      }),
    ).toThrow('compile boom');
    const after = session.getSnapshot();
    expect(resolverCalls).toBeGreaterThan(2);
    expect(session.revision).toBe(0n);
    expect(after.project).toBe(before.project);
    expect(after.renderIr).toBe(before.renderIr);
    expect(after.renderIr?.revision).toBe(0n);
    expect(session.getStats().compile).toBe(beforeCompile);
    expect(session.transaction.canUndo).toBe(false);
    expect(session.transaction.canRedo).toBe(false);
    expect(events).toEqual([]);
    if (after.project === null) throw new Error('Project disappeared after rejected edit');
    await expect(canonicalHash(after.project)).resolves.toBe(beforeHash);

    fail = false;
    const commit = session.transaction.edit(edit => {
      edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.67);
    });
    expect(commit.revision).toBe(1n);
    expect(session.getSnapshot().renderIr?.revision).toBe(1n);
    expect(session.transaction.canUndo).toBe(true);
    expect(events).toEqual([1n]);
    await session.dispose();
  });

  it('cannot revive Project or Render IR when a Material resolver disposes the Session', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    let disposeOnResolve = false;
    const session = new AelionSession({
      materials: {
        resolveProgram: () => {
          if (disposeOnResolve) void session.dispose();
          return undefined;
        },
      },
    });
    await session.loadProject(project);
    const events: bigint[] = [];
    session.subscribe('project-changed', event => events.push(event.commit.revision));
    disposeOnResolve = true;

    expect(() =>
      session.transaction.edit(edit => {
        edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.66);
      }),
    ).toThrow('disposed');
    await session.dispose();
    expect(session.state).toBe('disposed');
    expect(session.revision).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ project: null, renderIr: null });
    expect(events).toEqual([]);
  });

  it('publishes commits only after Render IR and history are synchronized', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const session = new AelionSession();
    await session.loadProject(project);
    const observations: unknown[] = [];
    session.subscribe('project-changed', event => {
      observations.push({
        revision: session.revision,
        commitRevision: event.commit.revision,
        irRevision: session.getSnapshot().renderIr?.revision,
        canUndo: session.transaction.canUndo,
      });
      expect(() => session.transaction.undo()).toThrow(/History cannot be mutated/u);
    });
    session.transaction.edit(edit => {
      edit.setField('items', 'item_opening', ['visual', 'opacity'], 0.9);
    });
    expect(observations).toEqual([
      { revision: 1n, commitRevision: 1n, irRevision: 1n, canUndo: true },
    ]);
    expect(session.revision).toBe(1n);
    await session.dispose();
  });

  it('preserves undo and redo history when their Render IR preparation fails', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    let rejectedIntensity: number | null = null;
    const session = new AelionSession({
      materials: {
        resolveProgram: (_definition, parameters) => {
          if (rejectedIntensity !== null && parameters.intensity === rejectedIntensity) {
            throw new Error('history compile failed');
          }
          return undefined;
        },
      },
    });
    await session.loadProject(project);
    session.transaction.edit(edit => {
      edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.67);
    });
    const edited = session.getSnapshot();
    const editedStats = session.getStats().compile;
    rejectedIntensity = 0.65;

    expect(() => session.transaction.undo()).toThrow('history compile failed');
    expect(session.revision).toBe(1n);
    expect(session.getSnapshot().project).toBe(edited.project);
    expect(session.getSnapshot().renderIr).toBe(edited.renderIr);
    expect(session.getStats().compile).toBe(editedStats);
    expect(session.transaction.canUndo).toBe(true);
    expect(session.transaction.canRedo).toBe(false);

    rejectedIntensity = null;
    session.transaction.undo();
    const undone = session.getSnapshot();
    const undoneStats = session.getStats().compile;
    expect(session.revision).toBe(2n);
    expect(session.transaction.canUndo).toBe(false);
    expect(session.transaction.canRedo).toBe(true);
    rejectedIntensity = 0.67;

    expect(() => session.transaction.redo()).toThrow('history compile failed');
    expect(session.revision).toBe(2n);
    expect(session.getSnapshot().project).toBe(undone.project);
    expect(session.getSnapshot().renderIr).toBe(undone.renderIr);
    expect(session.getStats().compile).toBe(undoneStats);
    expect(session.transaction.canUndo).toBe(false);
    expect(session.transaction.canRedo).toBe(true);

    rejectedIntensity = null;
    session.transaction.redo();
    expect(session.revision).toBe(3n);
    expect(session.transaction.canUndo).toBe(true);
    expect(session.transaction.canRedo).toBe(false);
    await session.dispose();
  });

  it('rejects command edits against the old Project while a replacement load is pending', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const replacement = structuredClone(project);
    replacement.projectId = 'replacement';
    const session = new AelionSession();
    await session.loadProject(project);
    const before = session.getSnapshot().project;
    const resetGate = deferred<undefined>();
    vi.spyOn(session.player, 'reset').mockImplementationOnce(() => resetGate.promise);
    const loading = session.loadProject(replacement);

    expect(() =>
      session.transaction.commands.trimItem({
        itemId: 'item_opening',
        edge: 'end',
        toUs: 15_000_000,
      }),
    ).toThrow(/load is pending/u);
    expect(session.revision).toBe(0n);
    expect(session.getSnapshot().project).toBe(before);
    resetGate.resolve(undefined);
    await loading;
    expect(session.getSnapshot().project?.projectId).toBe('replacement');
    await session.dispose();
  });

  it('cannot install or announce a Project after Session disposal starts', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const session = new AelionSession();
    const resetGate = deferred<undefined>();
    const reset = vi.spyOn(session.player, 'reset').mockImplementation(() => resetGate.promise);
    const events: string[] = [];
    session.subscribe(event => events.push(event.type));

    const loading = session.loadProject(project);
    await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce());
    const firstDispose = session.dispose();
    const secondDispose = session.dispose();
    expect(secondDispose).toBe(firstDispose);
    resetGate.resolve(undefined);

    await expect(loading).rejects.toThrow('disposed');
    await firstDispose;
    expect(session.dispose()).toBe(firstDispose);
    expect(session.state).toBe('disposed');
    expect(session.player.getStats().state).toBe('disposed');
    expect(session.revision).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ project: null, renderIr: null });
    expect(events).not.toContain('project-loaded');
  });

  it('serializes concurrent loads and never lets an older request overwrite the newer one', async () => {
    const firstProject = await json('examples/aelion-vertical-slice-30s.project.json');
    const secondProject = structuredClone(firstProject);
    secondProject.projectId = 'project_newer';
    const session = new AelionSession();
    const resetGates: Deferred<undefined>[] = [];
    vi.spyOn(session.player, 'reset').mockImplementation(() => {
      const gate = deferred<undefined>();
      resetGates.push(gate);
      return gate.promise;
    });
    const loadedProjectIds: string[] = [];
    session.subscribe('project-loaded', event => loadedProjectIds.push(event.projectId));

    const older = session.loadProject(firstProject);
    await vi.waitFor(() => expect(resetGates).toHaveLength(1));
    const newer = session.loadProject(secondProject);
    resetGates[0]?.resolve(undefined);
    await expect(older).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(resetGates).toHaveLength(2));
    resetGates[1]?.resolve(undefined);
    await newer;

    expect(session.getSnapshot().project?.projectId).toBe('project_newer');
    expect(loadedProjectIds).toEqual(['project_newer']);
    await session.dispose();
  });

  it('rejects public rendering without an explicit media provider', async () => {
    const [project, projectSchema, materialInstanceSchema] = await Promise.all([
      json('examples/aelion-vertical-slice-30s.project.json'),
      json('schemas/project/v1/project.schema.json'),
      json('schemas/material/v1/instance.schema.json'),
    ]);
    const session = await Aelion.createSession({
      schemas: { project: projectSchema, materialInstance: materialInstanceSchema },
    });
    await session.loadProject(project);
    const statsEvents: number[] = [];
    const states: string[] = [];
    const unsubscribeStats = session.subscribe('stats-changed', event => {
      statsEvents.push(event.stats.preview.requestedFrames);
    });
    session.subscribe('state-changed', event => states.push(event.state));
    await expect(session.preview.renderFrame({ timeUs: 0 })).rejects.toThrow('media provider');
    expect(session.getStats().preview).toMatchObject({
      requestedFrames: 1,
      renderedFrames: 0,
      failedFrames: 1,
      pendingFrames: 0,
      maxPendingFrames: 2,
      rendererPresent: false,
      rendererDisposed: true,
      workerPendingRequests: 0,
      workerActiveRequests: 0,
      workerCancelledRequests: 0,
      lastDisposedRenderer: null,
    });
    expect(session.player.getStats().resources).toMatchObject({
      listeners: 0,
      runtimeInitializing: false,
      audioFillScheduled: false,
      audioFillInFlight: false,
      scheduler: { present: false, disposed: true, scheduled: false, rendering: false },
      audio: { mode: 'none', disposed: true, bufferedFrames: 0, closed: true },
      lastDisposedRuntime: null,
    });
    expect(statsEvents).toContain(1);
    expect(states).toEqual([]);
    unsubscribeStats();
    await session.dispose();
  });

  it('bundles default v1 schemas so a Project loads without consumer schema assets', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const session = await Aelion.createSession();
    const states: string[] = [];
    session.subscribe('state-changed', event => states.push(event.state));
    try {
      await session.loadProject(project);
      expect(session.state).toBe('ready');
      expect(session.getSnapshot().project?.projectId).toBe(project.projectId);
      expect(session.getStats().compile?.compiledClips).toBeGreaterThan(0);
      expect(states).toEqual(['ready']);
    } finally {
      await session.dispose();
    }
    expect(states).toEqual(['ready', 'disposed']);
  });

  it('publishes stable validation diagnostics through snapshot and typed subscription', async () => {
    const session = await Aelion.createSession();
    const codes: string[] = [];
    session.subscribe('diagnostic', event => codes.push(event.diagnostic.code));
    await expect(session.loadProject({ projectId: 'invalid' })).rejects.toSatisfy(
      (error: unknown) => {
        if (error === null || typeof error !== 'object') return false;
        const diagnostics: unknown = Reflect.get(error, 'diagnostics');
        return (
          Array.isArray(diagnostics) &&
          diagnostics.every(
            (diagnostic: unknown) =>
              diagnostic !== null &&
              typeof diagnostic === 'object' &&
              Reflect.get(diagnostic, 'code') === 'PROJECT_SCHEMA_INVALID',
          )
        );
      },
    );
    expect(codes).toContain('PROJECT_SCHEMA_INVALID');
    expect(session.getDiagnostics().length).toBeGreaterThan(0);
    expect(session.getDiagnostics().every(value => value.code === 'PROJECT_SCHEMA_INVALID')).toBe(
      true,
    );
    await session.dispose();
  });

  it('keeps diagnostic history bounded and reports evictions', async () => {
    const session = await Aelion.createSession({ maxDiagnostics: 2 });
    try {
      for (let index = 0; index < 3; index += 1) {
        await expect(
          session.loadProject({ projectId: `invalid-${index.toString()}` }),
        ).rejects.toBeInstanceOf(Error);
      }
      expect(session.getDiagnostics()).toHaveLength(2);
      const diagnosticStats = session.getStats().diagnostics;
      expect(diagnosticStats.retained).toBe(2);
      expect(diagnosticStats.limit).toBe(2);
      expect(diagnosticStats.dropped).toBeGreaterThan(0);
    } finally {
      await session.dispose();
    }
    expect(() => Aelion.createSession({ maxDiagnostics: 0 })).toThrow('maxDiagnostics');
    expect(() => Aelion.createSession({ maxPendingFrames: 0 })).toThrow('maxPendingFrames');
  });

  it('does not expose mutable Render IR or compile ranges through snapshots', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const session = await Aelion.createSession();
    try {
      await session.loadProject(project);
      const renderIr = session.getSnapshot().renderIr;
      if (renderIr === null) throw new Error('Render IR was not compiled');
      const originalDuration = renderIr.durationUs;
      expect(Object.isFrozen(renderIr)).toBe(true);
      expect(Object.isFrozen(renderIr.tracks)).toBe(true);
      expect(Object.isFrozen(renderIr.tracks[0])).toBe(true);
      expect(Reflect.set(renderIr, 'durationUs', 1)).toBe(false);
      expect(session.getSnapshot().renderIr?.durationUs).toBe(originalDuration);

      session.transaction.edit(edit => {
        edit.setField('items', 'item_opening', ['visual', 'opacity'], 0.9);
      });
      const compile = session.getStats().compile;
      expect(Object.isFrozen(compile)).toBe(true);
      expect(Object.isFrozen(compile?.affectedRanges)).toBe(true);
      expect(Object.isFrozen(compile?.affectedRanges[0])).toBe(true);
    } finally {
      await session.dispose();
    }
  });

  it('provides an await-compatible export job with progress and explicit cancellation', async () => {
    let release: (() => void) | undefined;
    const job = new ExportJob({
      id: 'export-test',
      run: async (signal, onProgress) => {
        onProgress(0.25);
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        });
        return { mimeType: 'video/webm', videoFrames: 1, audioFrames: 1, durationUs: 1 };
      },
    });
    const snapshots: string[] = [];
    job.subscribe(snapshot => snapshots.push(`${snapshot.state}:${snapshot.progress.toString()}`));
    await Promise.resolve();
    expect(job).toBeInstanceOf(Promise);
    expect(job.getSnapshot()).toEqual({ id: 'export-test', state: 'running', progress: 0.25 });
    await job.cancel();
    expect(job.state).toBe('cancelled');
    await expect(job.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(snapshots).toContain('cancelled:0.25');
    release?.();

    const completed = new ExportJob({
      id: 'export-complete',
      run: () =>
        Promise.resolve({
          mimeType: 'video/webm',
          videoFrames: 2,
          audioFrames: 3,
          durationUs: 4,
        }),
    });
    await expect(completed).resolves.toMatchObject({ videoFrames: 2 });
    expect(completed.getSnapshot()).toEqual({
      id: 'export-complete',
      state: 'completed',
      progress: 1,
    });
  });

  it('rejects a concurrent export with a stable diagnostic', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const session = await Aelion.createSession({
      media: {
        frameAt: () => Promise.reject(new Error('not reached')),
        pcmRange: () => Promise.reject(new Error('not reached')),
      },
    });
    await session.loadProject(project);
    const sink = new WritableStream<
      WebMExportOptions['sink'] extends WritableStream<infer T> ? T : never
    >();
    const first = session.export.start({ sink });
    let rejected: unknown;
    try {
      const unexpected = session.export.start({ sink: new WritableStream() });
      void unexpected.catch(() => undefined);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'EXPORT_JOB_ACTIVE' })],
    });
    await first.cancel();
    await session.dispose();
  });

  it('records export failures in Session diagnostics before the job rejects', async () => {
    const project = await json('examples/aelion-vertical-slice-30s.project.json');
    const session = await Aelion.createSession({
      media: {
        frameAt: () => Promise.reject(new Error('not reached')),
        pcmRange: () => Promise.reject(new Error('not reached')),
      },
    });
    await session.loadProject(project);
    const codes: string[] = [];
    session.subscribe('diagnostic', event => codes.push(event.diagnostic.code));
    const job = session.export.start({ sink: new WritableStream() });

    let rejected: unknown;
    try {
      await job.result;
    } catch (error) {
      rejected = error;
    }
    if (rejected === null || typeof rejected !== 'object') {
      throw new Error('Expected structured export failure');
    }
    const rejectedDiagnostics: unknown = Reflect.get(rejected, 'diagnostics');
    expect(Array.isArray(rejectedDiagnostics)).toBe(true);
    const rejectedCodes: unknown[] = Array.isArray(rejectedDiagnostics)
      ? rejectedDiagnostics.map((diagnostic: unknown): unknown =>
          diagnostic !== null && typeof diagnostic === 'object'
            ? (Reflect.get(diagnostic, 'code') as unknown)
            : undefined,
        )
      : [];
    expect(rejectedCodes).toEqual(
      expect.arrayContaining([
        'EXPORT_VIDEO_ENCODER_UNAVAILABLE',
        'EXPORT_AUDIO_ENCODER_UNAVAILABLE',
      ]),
    );
    expect(job.state).toBe('failed');
    expect(codes).toEqual(
      expect.arrayContaining([
        'EXPORT_VIDEO_ENCODER_UNAVAILABLE',
        'EXPORT_AUDIO_ENCODER_UNAVAILABLE',
      ]),
    );
    expect(session.getDiagnostics().map(diagnostic => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'EXPORT_VIDEO_ENCODER_UNAVAILABLE',
        'EXPORT_AUDIO_ENCODER_UNAVAILABLE',
      ]),
    );
    expect(session.getStats().export.jobsFailed).toBe(1);
    await session.dispose();
  });
});
