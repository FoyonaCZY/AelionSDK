import { renderIrAudio } from '@aelion/audio';
import { probeCapabilities } from '@aelion/capability';
import { AelionError, type Diagnostic } from '@aelion/core';
import {
  createRemoteExportContentId,
  exportFrozenRenderIrMp4,
  exportFrozenRenderIrWebM,
  exportGif,
  exportStillImage,
  exportWav,
  preflightProfileExport,
  preflightWebMExport,
  runRemoteExport,
  type FrozenWebMExportOptions,
} from '@aelion/export';
import { canonicalStringify, ProjectValidator, type AelionProject } from '@aelion/project-schema';
import { IncrementalRenderCompiler, type CompileStats, type RenderIr } from '@aelion/render-ir';
import { RenderIrFrameRenderer, type RenderIrFrameRendererSnapshot } from '@aelion/renderer-worker';
import {
  EditingCommands,
  TransactionEngine,
  TransactionHistory,
  type TransactionBuilder,
  type TransactionCommit,
} from '@aelion/transaction';

import { AelionPlayer } from './player.js';
import { normalizePreviewQuality } from './preview-quality.js';
import { defaultSchemas } from './default-schemas.js';
import { ExportJob } from './export-job.js';
import type {
  AelionExportApi,
  AelionExportJob,
  AelionExportJobSnapshot,
  AelionExportOptions,
  AelionInteractiveEdit,
  AelionInteractiveEditOptions,
  AelionProfileExportJob,
  AelionProfileExportOptions,
  AelionProfileExportResult,
  AelionRemoteExportJob,
  AelionRemoteExportOptions,
  AelionPreviewApi,
  AelionPreviewOptions,
  AelionSessionApi,
  AelionSessionEvent,
  AelionSessionEventOf,
  AelionSessionEventType,
  AelionSessionOptions,
  AelionSessionSnapshot,
  AelionSessionStats,
  AelionSessionState,
  AelionTransactionApi,
} from './types.js';

function unloaded(): Error {
  return new Error('Load an Aelion Project before using this session');
}

function channelCountForLayout(layout: string): number {
  if (layout === 'mono') return 1;
  if (layout === 'stereo') return 2;
  if (layout === '5.1') return 6;
  throw new RangeError(`Unsupported channel layout ${layout}`);
}

const DEFAULT_MAX_DIAGNOSTICS = 256;

function diagnosticHistoryLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_DIAGNOSTICS;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError('maxDiagnostics must be a positive safe integer');
  }
  return limit;
}

interface ActiveInteractiveEdit {
  readonly id: string;
  readonly label?: string;
  readonly baseRevision?: bigint;
  active: boolean;
  updateCount: number;
}

export class AelionSession implements AelionSessionApi {
  readonly #options: AelionSessionOptions;
  readonly #validator: ProjectValidator;
  #compiler = new IncrementalRenderCompiler();
  #renderer: RenderIrFrameRenderer | undefined;
  #lastDisposedRenderer: RenderIrFrameRendererSnapshot | undefined;
  readonly #listeners = new Set<(event: AelionSessionEvent) => void>();
  #state: AelionSessionState = 'empty';
  #capability: Awaited<ReturnType<typeof probeCapabilities>> | undefined;
  readonly #diagnostics: Diagnostic[] = [];
  readonly #maxDiagnostics: number;
  #droppedDiagnostics = 0;
  #engine: TransactionEngine | undefined;
  #history: TransactionHistory | undefined;
  #commands: EditingCommands | undefined;
  #unsubscribeHistory: (() => void) | undefined;
  #ir: RenderIr | undefined;
  #compileStats: CompileStats | undefined;
  #sequenceId: string | undefined;
  #previewRequestedFrames = 0;
  #previewRenderedFrames = 0;
  #previewFailedFrames = 0;
  #lastPreviewBackend: 'webgpu' | 'webgl2' | undefined;
  #lastPreviewWidth: number | undefined;
  #lastPreviewHeight: number | undefined;
  #lastPreviewRenderScale: number | undefined;
  #exportJobsStarted = 0;
  #exportJobsCompleted = 0;
  #exportJobsFailed = 0;
  #exportJobsCancelled = 0;
  #activeExportJob: AelionExportJob | AelionProfileExportJob | AelionRemoteExportJob | undefined;
  #nextExportJobId = 1;
  #loadGeneration = 0;
  #loadInProgress = 0;
  #loadTail: Promise<void> = Promise.resolve();
  #disposeTask: Promise<void> | undefined;
  #activeInteractiveEdit: ActiveInteractiveEdit | undefined;
  #nextInteractiveEditId = 1;

  public readonly player: AelionPlayer;
  public readonly transaction: AelionTransactionApi;
  public readonly preview: AelionPreviewApi;
  public readonly export: AelionExportApi;

  public constructor(options: AelionSessionOptions = {}) {
    this.#options = options;
    this.#maxDiagnostics = diagnosticHistoryLimit(options.maxDiagnostics);
    if (
      options.maxPendingFrames !== undefined &&
      (!Number.isSafeInteger(options.maxPendingFrames) || options.maxPendingFrames <= 0)
    ) {
      throw new RangeError('maxPendingFrames must be a positive safe integer');
    }
    this.#validator = new ProjectValidator({
      projectSchema: (options.schemas ?? defaultSchemas).project,
      materialInstanceSchema: (options.schemas ?? defaultSchemas).materialInstance,
    });
    this.player = new AelionPlayer(this, (error: unknown) => this.#acceptPlayerError(error));
    this.preview = {
      renderFrame: options => this.#renderPreviewFrame(options),
    };
    const commands = (): EditingCommands => this.#requireCommands();
    const canUndo = (): boolean => this.#history?.state.canUndo ?? false;
    const canRedo = (): boolean => this.#history?.state.canRedo ?? false;
    this.transaction = {
      edit: (callback, editOptions = {}) => this.#edit(callback, editOptions),
      beginInteractive: editOptions => this.#beginInteractiveEdit(editOptions),
      undo: () => this.#undoChange(),
      redo: () => this.#redoChange(),
      get commands() {
        return commands();
      },
      get canUndo() {
        return canUndo();
      },
      get canRedo() {
        return canRedo();
      },
    };
    const activeExportJob = () => this.#activeExportJob ?? null;
    this.export = {
      preflight: options => this.#preflight(options),
      preflightProfile: options => this.#preflightProfile(options),
      start: options => this.#startExport(options),
      startProfile: options => this.#startProfileExport(options),
      startRemote: options => this.#startRemoteExport(options),
      cancel: reason => this.#cancelExport(reason),
      get activeJob() {
        return activeExportJob();
      },
    };
  }

  public get state(): AelionSessionState {
    return this.#state;
  }

  public get revision(): bigint | null {
    return this.#engine?.revision ?? null;
  }

  public async loadProject(value: unknown): Promise<void> {
    this.#assertActive();
    const validation = this.#validator.validate(value);
    if (!validation.ok) {
      for (const diagnostic of validation.diagnostics) this.#recordDiagnostic(diagnostic);
      throw new AelionError(validation.diagnostics);
    }

    const generation = this.#loadGeneration + 1;
    this.#loadGeneration = generation;
    this.#loadInProgress += 1;
    const task = this.#loadTail.then(() =>
      this.#installProject(validation.value.project, generation),
    );
    // Serialize reset/install work so a superseded load cannot finish resetting
    // Player resources after a newer Project has already become visible. Keep the
    // tail fulfilled so one failed/superseded load cannot block the next request.
    this.#loadTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task.finally(() => {
      this.#loadInProgress -= 1;
    });
  }

  async #installProject(project: AelionProject, generation: number): Promise<void> {
    this.#assertLoadCurrent(generation);
    this.#invalidateInteractiveEdit();
    await this.player.reset();
    this.#assertLoadCurrent(generation);

    const engineRef: { current?: TransactionEngine } = {};
    const engine = new TransactionEngine(
      project,
      candidate => {
        const result = this.#validator.validate(candidate);
        return { ok: result.ok, diagnostics: result.diagnostics };
      },
      {
        prepareCommit: commit => {
          const current = engineRef.current;
          if (current === undefined) throw new Error('Transaction engine is not installed');
          return this.#prepareCommit(current, commit);
        },
      },
    );
    engineRef.current = engine;
    const history = new TransactionHistory(engine);
    const commands = new EditingCommands({
      get revision() {
        return history.revision;
      },
      getSnapshot: () => history.getSnapshot(),
      subscribe: listener => history.subscribe(listener),
      edit: (editOptions, callback) => {
        this.#assertTransactionAvailable();
        if (this.#history !== history)
          throw new Error('Editing command belongs to a stale Project');
        if (this.#activeInteractiveEdit?.active === true) {
          throw new Error(
            'Finish or cancel the active interactive edit before starting another edit',
          );
        }
        return history.edit(editOptions, callback);
      },
    });
    const sequenceId = this.#options.sequenceId ?? project.settings.defaultSequenceId;
    const compiler = new IncrementalRenderCompiler();
    const compilation = compiler.compile(engine.getSnapshot(), sequenceId, engine.revision, {
      resolveMaterialProgram: (definition, parameters) =>
        this.#options.materials?.resolveProgram(definition, parameters),
    });
    // A synchronous host Material resolver may re-enter the Session and dispose
    // it (or request a newer load) while compilation is running.
    this.#assertLoadCurrent(generation);

    const unsubscribeHistory = history.subscribe(commit => this.#publishCommit(engine, commit));
    this.#unsubscribeHistory?.();
    this.#engine = engine;
    this.#unsubscribeHistory = unsubscribeHistory;
    this.#history = history;
    this.#commands = commands;
    this.#sequenceId = sequenceId;
    this.#compiler = compiler;
    this.#compileStats = compilation.stats;
    this.#ir = compilation.ir;
    this.#setState('ready');
    // `state-changed` listeners are user callbacks and may synchronously dispose
    // the Session or request another Project. Roll back this just-installed
    // candidate before surfacing the stale load so no engine survives disposal.
    try {
      this.#assertLoadCurrent(generation);
    } catch (error) {
      unsubscribeHistory();
      if (this.#engine === engine) {
        this.#engine = undefined;
        this.#unsubscribeHistory = undefined;
        this.#history = undefined;
        this.#commands = undefined;
        this.#sequenceId = undefined;
        this.#ir = undefined;
        this.#compileStats = undefined;
      }
      throw error;
    }
    this.#emit({
      type: 'project-loaded',
      projectId: project.projectId,
      revision: engine.revision,
    });
  }

  public async renderFrame(options: AelionPreviewOptions) {
    return this.#renderPreviewFrame(options);
  }

  async #renderPreviewFrame(options: AelionPreviewOptions) {
    this.#previewRequestedFrames += 1;
    this.#emitStats();
    try {
      const ir = this.requireIr();
      const media = this.#options.media;
      if (media === undefined) throw new Error('AelionSession requires a media provider to render');
      const previewQuality = normalizePreviewQuality(options);
      const result = await this.#requireRenderer().render({
        ir,
        timeUs: options.timeUs,
        source: media,
        mode: 'preview',
        preferredBackend: this.#options.preferredBackend ?? 'webgl2',
        allowFallback: this.#options.allowBackendFallback ?? true,
        renderScale: previewQuality.renderScale,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      this.#previewRenderedFrames += 1;
      this.#lastPreviewBackend = result.backend;
      this.#lastPreviewWidth = result.width;
      this.#lastPreviewHeight = result.height;
      this.#lastPreviewRenderScale = result.renderScale;
      this.#emitStats();
      return result;
    } catch (error) {
      this.#previewFailedFrames += 1;
      this.#recordErrorDiagnostics(error);
      this.#emitStats();
      throw error;
    }
  }

  public async probeCapabilities(signal?: AbortSignal) {
    this.#assertActive();
    const capability = await probeCapabilities(signal === undefined ? {} : { signal });
    this.#capability = capability;
    for (const diagnostic of capability.diagnostics) this.#recordDiagnostic(diagnostic);
    this.#emit({ type: 'capability-changed', capability });
    return capability;
  }

  public getSnapshot(): AelionSessionSnapshot {
    return Object.freeze({
      state: this.#state,
      revision: this.revision,
      project: this.#engine?.getSnapshot() ?? null,
      renderIr: this.#ir ?? null,
      capability: this.#capability ?? null,
      diagnostics: this.getDiagnostics(),
      stats: this.getStats(),
    });
  }

  public getCapabilitySnapshot() {
    return this.#capability ?? null;
  }

  public getDiagnostics(): readonly Diagnostic[] {
    return Object.freeze([...this.#diagnostics]);
  }

  public getStats(): AelionSessionStats {
    const active = this.#activeExportJob?.getSnapshot();
    const renderer = this.#renderer?.snapshot();
    return Object.freeze({
      schemaVersion: '1.0.0' as const,
      revision: this.revision,
      diagnostics: Object.freeze({
        retained: this.#diagnostics.length,
        dropped: this.#droppedDiagnostics,
        limit: this.#maxDiagnostics,
      }),
      compile: this.#compileStats ?? null,
      preview: Object.freeze({
        requestedFrames: this.#previewRequestedFrames,
        renderedFrames: this.#previewRenderedFrames,
        failedFrames: this.#previewFailedFrames,
        lastBackend: this.#lastPreviewBackend ?? null,
        lastWidth: this.#lastPreviewWidth ?? null,
        lastHeight: this.#lastPreviewHeight ?? null,
        lastRenderScale: this.#lastPreviewRenderScale ?? null,
        pendingFrames: renderer?.pendingFrames ?? 0,
        maxPendingFrames: renderer?.maxPendingFrames ?? this.#options.maxPendingFrames ?? 2,
        rendererPresent: renderer !== undefined,
        rendererDisposed: renderer?.disposed ?? true,
        workerPendingRequests: renderer?.worker.pendingRequests ?? 0,
        workerActiveRequests: renderer?.worker.activeRequests ?? 0,
        workerCancelledRequests: renderer?.worker.cancelledRequests ?? 0,
        lastDisposedRenderer:
          this.#lastDisposedRenderer === undefined
            ? null
            : Object.freeze({
                disposed: this.#lastDisposedRenderer.disposed,
                pendingFrames: this.#lastDisposedRenderer.pendingFrames,
                workerDisposed: this.#lastDisposedRenderer.worker.disposed,
                workerPendingRequests: this.#lastDisposedRenderer.worker.pendingRequests,
                workerActiveRequests: this.#lastDisposedRenderer.worker.activeRequests,
                workerCancelledRequests: this.#lastDisposedRenderer.worker.cancelledRequests,
              }),
      }),
      player: this.player.getStats(),
      export: Object.freeze({
        jobsStarted: this.#exportJobsStarted,
        jobsCompleted: this.#exportJobsCompleted,
        jobsFailed: this.#exportJobsFailed,
        jobsCancelled: this.#exportJobsCancelled,
        activeJobId: active?.id ?? null,
        progress: active?.progress ?? 0,
      }),
    });
  }

  public subscribe(listener: (event: AelionSessionEvent) => void): () => void;
  public subscribe<T extends AelionSessionEventType>(
    type: T,
    listener: (event: AelionSessionEventOf<T>) => void,
  ): () => void;
  public subscribe<T extends AelionSessionEventType>(
    typeOrListener: T | ((event: AelionSessionEvent) => void),
    typedListener?: (event: AelionSessionEventOf<T>) => void,
  ): () => void {
    this.#assertActive();
    const listener: (event: AelionSessionEvent) => void =
      typeof typeOrListener === 'function'
        ? typeOrListener
        : event => {
            if (event.type === typeOrListener) typedListener?.(event as AelionSessionEventOf<T>);
          };
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public dispose(): Promise<void> {
    const existing = this.#disposeTask;
    if (existing !== undefined) return existing;

    let resolveTask!: () => void;
    let rejectTask!: (reason?: unknown) => void;
    const task = new Promise<void>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    // Publish the task before cleanup emits `state-changed`; a listener may call
    // dispose() re-entrantly and must receive this exact Promise.
    this.#disposeTask = task;
    void this.#dispose().then(resolveTask, rejectTask);
    return task;
  }

  async #dispose(): Promise<void> {
    this.#loadGeneration += 1;
    this.#invalidateInteractiveEdit();
    const drainLoads = this.#loadTail.then(
      () => undefined,
      () => undefined,
    );
    const renderer = this.#renderer;
    const cancelExport = this.#cancelExport(
      new DOMException('AelionSession disposed', 'AbortError'),
    );
    this.#setState('disposed');
    this.#listeners.clear();
    this.#unsubscribeHistory?.();
    this.#unsubscribeHistory = undefined;
    this.#engine = undefined;
    this.#history = undefined;
    this.#commands = undefined;
    this.#ir = undefined;
    this.#compileStats = undefined;
    this.#sequenceId = undefined;
    this.#compiler.clear();
    const results = await Promise.allSettled([
      cancelExport,
      this.player.dispose(),
      drainLoads,
      ...(renderer === undefined ? [] : [renderer.dispose()]),
    ]);
    if (renderer !== undefined) this.#lastDisposedRenderer = renderer.snapshot();
    this.#renderer = undefined;
    const errors: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason as unknown);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more AelionSession resources failed to dispose');
    }
  }

  public requireIr(): RenderIr {
    this.#assertActive();
    if (this.#ir === undefined) throw unloaded();
    return this.#ir;
  }

  public requireMedia() {
    const media = this.#options.media;
    if (media === undefined) throw new Error('AelionSession requires a media provider');
    return media;
  }

  public notifyStatsChanged(): void {
    if (this.#state !== 'disposed') this.#emitStats();
  }

  #edit(
    callback: (transaction: TransactionBuilder) => void,
    options: { readonly label?: string; readonly baseRevision?: bigint },
  ): TransactionCommit {
    this.#assertTransactionAvailable();
    if (this.#activeInteractiveEdit?.active === true) {
      throw new Error('Finish or cancel the active interactive edit before starting another edit');
    }
    const history = this.#history;
    if (history === undefined) throw unloaded();
    return history.edit(
      {
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(options.baseRevision === undefined ? {} : { baseRevision: options.baseRevision }),
      },
      callback,
    );
  }

  #beginInteractiveEdit(options: AelionInteractiveEditOptions = {}): AelionInteractiveEdit {
    this.#assertTransactionAvailable();
    if (this.#activeInteractiveEdit?.active === true) {
      throw new Error('An interactive edit is already active');
    }
    const state: ActiveInteractiveEdit = {
      id: `interactive_${this.#nextInteractiveEditId.toString()}`,
      ...(options.label === undefined ? {} : { label: options.label }),
      ...(options.baseRevision === undefined ? {} : { baseRevision: options.baseRevision }),
      active: true,
      updateCount: 0,
    };
    this.#nextInteractiveEditId += 1;
    this.#activeInteractiveEdit = state;
    const isActive = (): boolean => state.active && this.#activeInteractiveEdit === state;
    return Object.freeze({
      get active() {
        return isActive();
      },
      get updateCount() {
        return state.updateCount;
      },
      update: (callback: (transaction: TransactionBuilder) => void) =>
        this.#updateInteractiveEdit(state, callback),
      commit: () => this.#finishInteractiveEdit(state),
      cancel: () => this.#cancelInteractiveEdit(state),
    });
  }

  #updateInteractiveEdit(
    state: ActiveInteractiveEdit,
    callback: (transaction: TransactionBuilder) => void,
  ): TransactionCommit {
    this.#assertInteractiveEditActive(state);
    const history = this.#history;
    if (history === undefined) throw unloaded();
    const commit = history.edit(
      {
        ...(state.label === undefined ? {} : { label: state.label }),
        ...(state.updateCount === 0 && state.baseRevision !== undefined
          ? { baseRevision: state.baseRevision }
          : {}),
        historyGroup: state.id,
      },
      callback,
    );
    state.updateCount += 1;
    return commit;
  }

  #finishInteractiveEdit(state: ActiveInteractiveEdit): void {
    this.#assertInteractiveEditActive(state);
    this.#history?.finishGroup(state.id);
    state.active = false;
    this.#activeInteractiveEdit = undefined;
  }

  #cancelInteractiveEdit(state: ActiveInteractiveEdit): TransactionCommit | null {
    this.#assertInteractiveEditActive(state);
    const history = this.#history;
    if (history === undefined) throw unloaded();
    const commit = state.updateCount === 0 ? null : history.cancelGroup(state.id);
    state.active = false;
    this.#activeInteractiveEdit = undefined;
    return commit;
  }

  #assertInteractiveEditActive(state: ActiveInteractiveEdit): void {
    this.#assertTransactionAvailable();
    if (!state.active || this.#activeInteractiveEdit !== state) {
      throw new Error('Interactive edit is no longer active');
    }
  }

  #invalidateInteractiveEdit(): void {
    if (this.#activeInteractiveEdit !== undefined) this.#activeInteractiveEdit.active = false;
    this.#activeInteractiveEdit = undefined;
  }

  #undoChange(): TransactionCommit {
    this.#assertTransactionAvailable();
    if (this.#activeInteractiveEdit?.active === true) {
      throw new Error('Finish or cancel the active interactive edit before undo');
    }
    const history = this.#history;
    if (history === undefined) throw unloaded();
    return history.undo();
  }

  #redoChange(): TransactionCommit {
    this.#assertTransactionAvailable();
    if (this.#activeInteractiveEdit?.active === true) {
      throw new Error('Finish or cancel the active interactive edit before redo');
    }
    const history = this.#history;
    if (history === undefined) throw unloaded();
    return history.redo();
  }

  #prepareCommit(engine: TransactionEngine, commit: TransactionCommit): { publish(): void } {
    this.#assertPreparedCommitCurrent(engine, commit.changeSet.baseRevision);
    const sequenceId = this.#sequenceId;
    if (sequenceId === undefined) throw unloaded();
    const baseCompiler = this.#compiler;
    const compiler = baseCompiler.fork();
    const compilation = compiler.compile(
      commit.snapshot as AelionProject,
      sequenceId,
      commit.revision,
      {
        affectedEntityIds: commit.changeSet.affectedEntityIds,
        affectedRanges: commit.changeSet.affectedRanges,
        resolveMaterialProgram: (definition, parameters) =>
          this.#options.materials?.resolveProgram(definition, parameters),
      },
    );
    this.#assertPreparedCommitCurrent(engine, commit.changeSet.baseRevision);
    let published = false;
    return {
      publish: () => {
        if (published) throw new Error('Prepared Render IR commit was already published');
        this.#assertPreparedCommitCurrent(engine, commit.changeSet.baseRevision);
        if (this.#compiler !== baseCompiler) {
          throw new Error('Prepared Render IR compiler baseline is stale');
        }
        published = true;
        this.#compiler = compiler;
        this.#compileStats = compilation.stats;
        this.#ir = compilation.ir;
      },
    };
  }

  #publishCommit(engine: TransactionEngine, commit: TransactionCommit): void {
    if (!this.#isCurrentEngine(engine, commit.revision)) return;
    this.#emit({ type: 'project-changed', commit });
    if (!this.#isCurrentEngine(engine, commit.revision)) return;
    this.player.invalidate(commit.changeSet);
  }

  #assertTransactionAvailable(): void {
    this.#assertActive();
    if (this.#loadInProgress > 0) {
      throw new Error('AelionSession Project transactions are unavailable while a load is pending');
    }
  }

  #assertPreparedCommitCurrent(engine: TransactionEngine, baseRevision: bigint): void {
    this.#assertActive();
    if (this.#engine !== engine || engine.revision !== baseRevision || this.#loadInProgress > 0) {
      throw new DOMException('AelionSession transaction was superseded', 'AbortError');
    }
  }

  #isCurrentEngine(engine: TransactionEngine, revision: bigint): boolean {
    return (
      this.#state !== 'disposed' &&
      this.#engine === engine &&
      this.#loadInProgress === 0 &&
      engine.revision === revision &&
      this.#ir?.revision === revision
    );
  }

  #frozenExportOptions(
    options: AelionExportOptions,
    signal = options.signal,
    onProgress = options.onProgress,
  ): FrozenWebMExportOptions {
    const ir = this.requireIr();
    const media = this.requireMedia();
    return {
      ir,
      projectRevision: ir.revision,
      videoBitrate: options.videoBitrate ?? 8_000_000,
      audioBitrate: options.audioBitrate ?? 192_000,
      sink: options.sink,
      renderFrame: async request => {
        const rendered = await this.#requireRenderer().render({
          ir,
          timeUs: request.timestampUs,
          source: media,
          mode: 'export',
          preferredBackend: this.#options.preferredBackend ?? 'webgl2',
          allowFallback: this.#options.allowBackendFallback ?? true,
          ...(signal === undefined ? {} : { signal }),
        });
        try {
          return new VideoFrame(rendered.bitmap, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          });
        } finally {
          rendered.bitmap.close();
        }
      },
      renderAudio: request =>
        renderIrAudio({
          ir,
          startFrame: request.startFrame,
          frameCount: request.frameCount,
          channelCount: request.channelCount,
          source: media,
          ...(signal === undefined ? {} : { signal }),
        }),
      ...(signal === undefined ? {} : { signal }),
      ...(options.cleanupSink === undefined ? {} : { cleanupSink: options.cleanupSink }),
      ...(onProgress === undefined ? {} : { onProgress }),
    };
  }

  async #preflight(options: AelionExportOptions) {
    const report = await preflightWebMExport(this.#frozenExportOptions(options));
    for (const diagnostic of report.issues) this.#recordDiagnostic(diagnostic);
    return report;
  }

  async #preflightProfile(options: AelionProfileExportOptions) {
    const ir = this.requireIr();
    const report = await preflightProfileExport({
      ir,
      projectRevision: ir.revision,
      profile: options.profile,
      sink: options.sink,
      ...('videoBitrate' in options ? { videoBitrate: options.videoBitrate } : {}),
      ...('audioBitrate' in options ? { audioBitrate: options.audioBitrate } : {}),
    });
    for (const diagnostic of report.issues) this.#recordDiagnostic(diagnostic);
    return report;
  }

  #startExport(options: AelionExportOptions): AelionExportJob {
    this.#assertActive();
    if (this.#activeExportJob?.state === 'running') {
      const diagnostics: readonly Diagnostic[] = [
        {
          code: 'EXPORT_JOB_ACTIVE',
          severity: 'error',
          message: 'AelionSession supports one active export; cancel it before starting another',
          recoverable: true,
        },
      ];
      for (const diagnostic of diagnostics) this.#recordDiagnostic(diagnostic);
      throw new AelionError(diagnostics);
    }
    const id = `export-${this.#nextExportJobId.toString()}`;
    this.#nextExportJobId += 1;
    this.#exportJobsStarted += 1;
    const job = new ExportJob({
      id,
      ...(options.signal === undefined ? {} : { externalSignal: options.signal }),
      run: async (signal, updateProgress) => {
        try {
          return await exportFrozenRenderIrWebM(
            this.#frozenExportOptions(options, signal, progress => {
              updateProgress(progress);
              options.onProgress?.(progress);
            }),
          );
        } catch (error) {
          // Publish structured export diagnostics before the await-compatible
          // job rejects so callers observe one deterministic Session state.
          this.#recordErrorDiagnostics(error);
          throw error;
        }
      },
      onSnapshot: snapshot => this.#acceptExportSnapshot(snapshot),
      onSettled: settled => {
        if (this.#activeExportJob === settled) this.#activeExportJob = undefined;
        this.#emitStats();
      },
    });
    this.#activeExportJob = job;
    this.#emitStats();
    return job;
  }

  #startProfileExport(options: AelionProfileExportOptions): AelionProfileExportJob {
    this.#assertActive();
    if (this.#activeExportJob?.state === 'running') {
      const diagnostic: Diagnostic = {
        code: 'EXPORT_JOB_ACTIVE',
        severity: 'error',
        message: 'AelionSession supports one active export; cancel it before starting another',
        recoverable: true,
      };
      this.#recordDiagnostic(diagnostic);
      throw new AelionError([diagnostic]);
    }
    const ir = this.requireIr();
    const media = this.requireMedia();
    const id = `export-${this.#nextExportJobId.toString()}`;
    this.#nextExportJobId += 1;
    this.#exportJobsStarted += 1;
    const job = new ExportJob<AelionProfileExportResult>({
      id,
      ...(options.signal === undefined ? {} : { externalSignal: options.signal }),
      run: async (signal, updateProgress) => {
        const onProgress = (progress: number): void => {
          updateProgress(progress);
          options.onProgress?.(progress);
        };
        const cleanup = options.cleanupSink;
        const renderFrame = async (request: {
          readonly timestampUs: number;
          readonly durationUs: number;
        }): Promise<VideoFrame> => {
          const rendered = await this.#requireRenderer().render({
            ir,
            timeUs: request.timestampUs,
            source: media,
            mode: 'export',
            preferredBackend: this.#options.preferredBackend ?? 'webgl2',
            allowFallback: this.#options.allowBackendFallback ?? true,
            signal,
          });
          try {
            return new VideoFrame(rendered.bitmap, {
              timestamp: request.timestampUs,
              duration: request.durationUs,
            });
          } finally {
            rendered.bitmap.close();
          }
        };
        const renderAudio = (request: {
          readonly startFrame: number;
          readonly frameCount: number;
          readonly channelCount: number;
        }) =>
          renderIrAudio({
            ir,
            startFrame: request.startFrame,
            frameCount: request.frameCount,
            channelCount: request.channelCount,
            source: media,
            signal,
          });
        try {
          if (options.profile === 'webm-vp9-opus' || options.profile === 'mp4-h264-aac') {
            const frozen = this.#frozenExportOptions(
              {
                sink: options.sink,
                ...(options.videoBitrate === undefined
                  ? {}
                  : { videoBitrate: options.videoBitrate }),
                ...(options.audioBitrate === undefined
                  ? {}
                  : { audioBitrate: options.audioBitrate }),
                ...(cleanup === undefined ? {} : { cleanupSink: cleanup }),
              },
              signal,
              onProgress,
            );
            return options.profile === 'mp4-h264-aac'
              ? await exportFrozenRenderIrMp4(frozen)
              : await exportFrozenRenderIrWebM(frozen);
          }
          if (options.profile === 'audio-wav') {
            return await exportWav({
              durationUs: ir.durationUs,
              sampleRate: ir.sampleRate,
              channelCount: channelCountForLayout(ir.channelLayout),
              sink: options.sink,
              renderAudio,
              signal,
              onProgress,
              ...(options.sampleFormat === undefined ? {} : { sampleFormat: options.sampleFormat }),
              ...(cleanup === undefined ? {} : { cleanupSink: cleanup }),
            });
          }
          if (options.profile === 'animated-gif') {
            return await exportGif({
              durationUs: ir.durationUs,
              width: ir.width,
              height: ir.height,
              frameRate: ir.frameRate,
              sink: options.sink,
              renderFrame,
              signal,
              onProgress,
              ...(options.loopCount === undefined ? {} : { loopCount: options.loopCount }),
              ...(cleanup === undefined ? {} : { cleanupSink: cleanup }),
            });
          }
          const format =
            options.profile === 'still-png'
              ? 'png'
              : options.profile === 'still-jpeg'
                ? 'jpeg'
                : 'webp';
          if (!('timeUs' in options)) throw new TypeError('Unsupported export profile');
          return await exportStillImage({
            timeUs: options.timeUs,
            width: ir.width,
            height: ir.height,
            format,
            sink: options.sink,
            renderFrame,
            signal,
            ...(options.quality === undefined ? {} : { quality: options.quality }),
            ...(cleanup === undefined ? {} : { cleanupSink: cleanup }),
          });
        } catch (error) {
          this.#recordErrorDiagnostics(error);
          throw error;
        }
      },
      onSnapshot: snapshot => this.#acceptExportSnapshot(snapshot),
      onSettled: settled => {
        if (this.#activeExportJob === settled) this.#activeExportJob = undefined;
        this.#emitStats();
      },
    });
    this.#activeExportJob = job;
    this.#emitStats();
    return job;
  }

  #startRemoteExport(options: AelionRemoteExportOptions): AelionRemoteExportJob {
    this.#assertActive();
    if (this.#activeExportJob?.state === 'running') {
      const diagnostic: Diagnostic = {
        code: 'EXPORT_JOB_ACTIVE',
        severity: 'error',
        message: 'AelionSession supports one active export; cancel it before starting another',
        recoverable: true,
      };
      this.#recordDiagnostic(diagnostic);
      throw new AelionError([diagnostic]);
    }
    const engine = this.#engine;
    const ir = this.requireIr();
    const sequenceId = this.#sequenceId;
    if (engine === undefined || sequenceId === undefined) throw unloaded();
    const project = engine.getSnapshot();
    const revision = ir.revision.toString();
    const manifest =
      options.manifest ??
      ({
        protocol: 'aelion.remote-export/1',
        profileId: options.profile,
        sequenceId,
        revision,
        project,
      } as const);
    const canonicalManifestBytes = new TextEncoder().encode(canonicalStringify(manifest));
    const id = `export-${this.#nextExportJobId.toString()}`;
    this.#nextExportJobId += 1;
    this.#exportJobsStarted += 1;
    const job = new ExportJob({
      id,
      ...(options.signal === undefined ? {} : { externalSignal: options.signal }),
      run: async (signal, updateProgress) => {
        try {
          const contentId = await createRemoteExportContentId(
            canonicalManifestBytes,
            options.profile,
            revision,
          );
          return await runRemoteExport({
            provider: options.provider,
            authorizer: options.authorizer,
            request: {
              contentId,
              idempotencyKey: options.idempotencyKey ?? contentId,
              profileId: options.profile,
              projectId: project.projectId,
              sequenceId,
              revision,
              manifest,
            },
            signal,
            onProgress: (progress, stage) => {
              updateProgress(progress);
              options.onProgress?.(progress, stage);
            },
          });
        } catch (error) {
          this.#recordErrorDiagnostics(error);
          throw error;
        }
      },
      onSnapshot: snapshot => this.#acceptExportSnapshot(snapshot),
      onSettled: settled => {
        if (this.#activeExportJob === settled) this.#activeExportJob = undefined;
        this.#emitStats();
      },
    });
    this.#activeExportJob = job;
    this.#emitStats();
    return job;
  }

  async #cancelExport(reason?: unknown): Promise<void> {
    await this.#activeExportJob?.cancel(reason);
  }

  #acceptExportSnapshot(snapshot: AelionExportJobSnapshot): void {
    if (snapshot.state === 'completed') this.#exportJobsCompleted += 1;
    else if (snapshot.state === 'cancelled') this.#exportJobsCancelled += 1;
    else if (snapshot.state === 'failed') this.#exportJobsFailed += 1;
    this.#emitStats();
  }

  #recordErrorDiagnostics(error: unknown): number {
    if (error === null || typeof error !== 'object') return 0;
    const diagnostics: unknown = Reflect.get(error, 'diagnostics');
    if (!Array.isArray(diagnostics)) return 0;
    let recorded = 0;
    for (const diagnostic of diagnostics) {
      if (this.#isDiagnostic(diagnostic)) {
        this.#recordDiagnostic(diagnostic);
        recorded += 1;
      }
    }
    return recorded;
  }

  #acceptPlayerError(error: unknown): void {
    if (this.#recordErrorDiagnostics(error) === 0) {
      this.#recordDiagnostic({
        code: 'PLAYER_RUNTIME_FAILED',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Player runtime failed',
        recoverable: true,
        cause: error,
      });
    }
    this.#emitStats();
  }

  #isDiagnostic(value: unknown): value is Diagnostic {
    return (
      value !== null &&
      typeof value === 'object' &&
      typeof Reflect.get(value, 'code') === 'string' &&
      typeof Reflect.get(value, 'message') === 'string' &&
      typeof Reflect.get(value, 'recoverable') === 'boolean'
    );
  }

  #recordDiagnostic(diagnostic: Diagnostic): void {
    if (this.#diagnostics.length === this.#maxDiagnostics) {
      this.#diagnostics.shift();
      this.#droppedDiagnostics += 1;
    }
    this.#diagnostics.push(diagnostic);
    this.#emit({ type: 'diagnostic', diagnostic });
  }

  #setState(state: AelionSessionState): void {
    if (this.#state === state) return;
    const previousState = this.#state;
    this.#state = state;
    this.#emit({ type: 'state-changed', previousState, state });
  }

  #emitStats(): void {
    this.#emit({ type: 'stats-changed', stats: this.getStats() });
  }

  #assertActive(): void {
    if (this.#state === 'disposed') throw new ReferenceError('AelionSession is disposed');
  }

  #assertLoadCurrent(generation: number): void {
    if (this.#state === 'disposed') throw new ReferenceError('AelionSession is disposed');
    if (generation !== this.#loadGeneration) {
      throw new DOMException('AelionSession Project load was superseded', 'AbortError');
    }
  }

  #requireRenderer(): RenderIrFrameRenderer {
    this.#assertActive();
    this.#renderer ??= new RenderIrFrameRenderer({
      ...(this.#options.maxPendingFrames === undefined
        ? {}
        : { maxPendingFrames: this.#options.maxPendingFrames }),
    });
    return this.#renderer;
  }

  #requireCommands(): EditingCommands {
    this.#assertTransactionAvailable();
    if (this.#commands === undefined) throw unloaded();
    return this.#commands;
  }

  #emit(event: AelionSessionEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // Consumer callbacks must not corrupt SDK state or stop other subscribers.
      }
    }
  }
}
