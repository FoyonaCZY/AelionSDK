import {
  AudioDrivenVideoScheduler,
  AudioWorkletClock,
  TransferableAudioWorkletClock,
  renderIrAudio,
  type ScheduledVideoFrame,
} from '@aelion/audio';
import { sampleIndexAtTime } from '@aelion/core';
import type { ChangeSet } from '@aelion/transaction';

import type { AelionSession } from './session.js';
import type {
  AelionPlayerApi,
  AelionPlayerFrame,
  AelionPlayerResourceStats,
  AelionPlayerState,
} from './types.js';

type Clock = AudioWorkletClock | TransferableAudioWorkletClock;

type RuntimeErrorListener = (error: unknown) => void;

function runtimeErrorCode(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const diagnostics: unknown = Reflect.get(error, 'diagnostics');
    if (Array.isArray(diagnostics)) {
      const first: unknown = diagnostics[0];
      const code: unknown =
        first !== null && typeof first === 'object' ? Reflect.get(first, 'code') : undefined;
      if (typeof code === 'string') return code;
    }
    const code: unknown = Reflect.get(error, 'code');
    if (typeof code === 'string') return code;
  }
  return 'PLAYER_RUNTIME_FAILED';
}

export class AelionPlayer implements AelionPlayerApi {
  readonly #session: AelionSession;
  readonly #onRuntimeError: RuntimeErrorListener | undefined;
  readonly #listeners = new Set<(frame: AelionPlayerFrame) => void>();
  #state: AelionPlayerState = 'idle';
  #clock: Clock | undefined;
  #scheduler: AudioDrivenVideoScheduler | undefined;
  #fillHandle: ReturnType<typeof globalThis.setInterval> | undefined;
  #nextAudioFrame = 0;
  #fillTask: Promise<void> | undefined;
  #fillGeneration = -1;
  #runtimeInitTask: Promise<void> | undefined;
  #runtimeDisposeTask: Promise<void> | undefined;
  #disposeTask: Promise<void> | undefined;
  #fillController = new AbortController();
  #videoController = new AbortController();
  #generation = 0;
  #lastTimeUs = 0;
  #renderedFrames = 0;
  #droppedFrames = 0;
  #errors = 0;
  #lastErrorCode: string | undefined;
  #lastDisposedRuntime: AelionPlayerResourceStats['lastDisposedRuntime'] = null;

  public constructor(session: AelionSession, onRuntimeError?: RuntimeErrorListener) {
    this.#session = session;
    this.#onRuntimeError = onRuntimeError;
  }

  public get state(): AelionPlayerState {
    return this.#state;
  }

  public get currentTimeUs(): number {
    if (this.#state === 'ended' || this.#state === 'error' || this.#state === 'disposed') {
      return this.#lastTimeUs;
    }
    return this.#clock?.nowUs() ?? this.#lastTimeUs;
  }

  public async play(): Promise<void> {
    try {
      if (this.#state === 'disposed') throw new ReferenceError('AelionPlayer is disposed');
      const ir = this.#session.requireIr();
      const generation = this.#generation;
      await this.#ensureRuntime();
      if (!this.#playContinuationCurrent(generation)) {
        throw new DOMException('Player play became stale', 'AbortError');
      }
      await this.#requestAudioFill(true);
      if (!this.#playContinuationCurrent(generation)) {
        throw new DOMException('Player play became stale', 'AbortError');
      }
      if (this.#state === 'paused') await this.#clock?.resume();
      else await this.#clock?.start();
      if (!this.#playContinuationCurrent(generation)) {
        throw new DOMException('Player play became stale', 'AbortError');
      }
      this.#state = 'playing';
      this.#session.notifyStatsChanged();
      this.#scheduler?.start();
      this.#fillHandle ??= globalThis.setInterval(() => {
        void this.#requestAudioFill(false);
      }, 20);
      if (this.currentTimeUs >= ir.durationUs) await this.seek(0);
    } catch (error) {
      this.#failRuntime(error);
      throw error;
    }
  }

  public async pause(): Promise<void> {
    if (this.#state === 'disposed') throw new ReferenceError('AelionPlayer is disposed');
    const generation = this.#generation;
    this.#scheduler?.pause();
    if (this.#clock !== undefined) await this.#clock.pause();
    if (this.#disposeTask !== undefined || generation !== this.#generation) return;
    if (this.#state !== 'idle') this.#state = 'paused';
    this.#lastTimeUs = this.currentTimeUs;
    this.#session.notifyStatsChanged();
  }

  public async seek(timeUs: number): Promise<void> {
    try {
      const ir = this.#session.requireIr();
      if (!Number.isSafeInteger(timeUs) || timeUs < 0 || timeUs >= ir.durationUs) {
        throw new RangeError('Player seek target is outside the sequence duration');
      }
      await this.#ensureRuntime();
      this.#advanceGeneration();
      const generation = this.#generation;
      const clock = this.#clock;
      if (clock instanceof AudioWorkletClock) clock.resetForSeek(timeUs);
      else clock?.seek(timeUs);
      this.#nextAudioFrame = sampleIndexAtTime(timeUs, ir.sampleRate);
      this.#lastTimeUs = timeUs;
      await this.#requestAudioFill(true);
      if (generation !== this.#generation) return;
      const signal = this.#videoController.signal;
      if (signal.aborted) return;
      const result = await this.#session.preview.renderFrame({ timeUs, signal });
      if (generation !== this.#generation) {
        result.bitmap.close();
        return;
      }
      this.#publish({ generation, frameIndex: -1, timestampUs: timeUs, droppedFrames: 0 }, result);
    } catch (error) {
      this.#failRuntime(error);
      throw error;
    }
  }

  public scrub(timeUs: number) {
    return this.#session.preview.renderFrame({ timeUs });
  }

  public getStats() {
    return Object.freeze({
      state: this.#state,
      currentTimeUs: this.currentTimeUs,
      generation: this.#generation,
      renderedFrames: this.#renderedFrames,
      droppedFrames: this.#droppedFrames,
      errors: this.#errors,
      lastErrorCode: this.#lastErrorCode ?? null,
      resources: this.#resourceStats(),
    });
  }

  #resourceStats(): AelionPlayerResourceStats {
    const scheduler = this.#scheduler?.snapshot();
    const clock = this.#clock;
    const queue =
      clock instanceof AudioWorkletClock
        ? clock.ring.snapshot()
        : clock instanceof TransferableAudioWorkletClock
          ? clock.snapshot()
          : undefined;
    return Object.freeze({
      listeners: this.#listeners.size,
      runtimeInitializing: this.#runtimeInitTask !== undefined,
      audioFillScheduled: this.#fillHandle !== undefined,
      audioFillInFlight: this.#fillTask !== undefined,
      scheduler: Object.freeze({
        present: scheduler !== undefined,
        disposed: scheduler?.disposed ?? true,
        scheduled: scheduler?.scheduled ?? false,
        rendering: scheduler?.rendering ?? false,
      }),
      audio: Object.freeze({
        mode:
          clock instanceof AudioWorkletClock
            ? ('shared-ring' as const)
            : clock instanceof TransferableAudioWorkletClock
              ? ('transferable-queue' as const)
              : ('none' as const),
        disposed: clock?.disposed ?? true,
        contextState: clock?.context.state ?? null,
        bufferedFrames:
          queue === undefined
            ? 0
            : 'availableReadFrames' in queue
              ? queue.availableReadFrames
              : queue.queuedFrames,
        closed:
          queue === undefined ? true : 'state' in queue ? queue.state === 'closed' : queue.closed,
      }),
      lastDisposedRuntime: this.#lastDisposedRuntime,
    });
  }

  public subscribe(listener: (frame: AelionPlayerFrame) => void): () => void {
    if (this.#state === 'disposed') throw new ReferenceError('AelionPlayer is disposed');
    if (this.#listeners.size > 0) {
      throw new Error('AelionPlayer supports one frame owner; unsubscribe before replacing it');
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public invalidate(changeSet: ChangeSet): void {
    void changeSet;
    const ir = this.#session.requireIr();
    const timeUs = Math.min(Math.max(0, this.currentTimeUs), ir.durationUs - 1);
    this.#advanceGeneration();
    const clock = this.#clock;
    if (clock instanceof AudioWorkletClock) clock.resetForSeek(timeUs);
    else clock?.seek(timeUs);
    this.#nextAudioFrame = sampleIndexAtTime(timeUs, ir.sampleRate);
    this.#lastTimeUs = timeUs;
    void this.#requestAudioFill(false);
  }

  public async reset(): Promise<void> {
    if (this.#state === 'disposed') return;
    this.#advanceGeneration();
    const generation = this.#generation;
    await this.#disposeRuntime();
    // The awaited runtime teardown permits a concurrent dispose() even though
    // TypeScript narrows the pre-await state check.
    if (this.#disposeTask !== undefined || generation !== this.#generation) return;
    this.#state = 'idle';
    this.#lastTimeUs = 0;
    this.#nextAudioFrame = 0;
  }

  public dispose(): Promise<void> {
    this.#disposeTask ??= this.#dispose();
    return this.#disposeTask;
  }

  async #dispose(): Promise<void> {
    if (this.#state === 'disposed') return;
    this.#advanceGeneration();
    // Publish the terminal state before the first await so concurrent reset or
    // runtime initialization cannot revive the Player while Session disposal runs.
    this.#state = 'disposed';
    this.#listeners.clear();
    await this.#disposeRuntime();
  }

  async #ensureRuntime(): Promise<void> {
    if (this.#scheduler !== undefined) return;
    const existing = this.#runtimeInitTask;
    if (existing !== undefined) return existing;
    const task = this.#initializeRuntime().finally(() => {
      if (this.#runtimeInitTask === task) this.#runtimeInitTask = undefined;
    });
    this.#runtimeInitTask = task;
    return task;
  }

  async #initializeRuntime(): Promise<void> {
    const ir = this.#session.requireIr();
    const generation = this.#generation;
    const clock =
      globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function'
        ? new AudioWorkletClock({
            capacityFrames: ir.sampleRate * 2,
            channelCount: ir.channelLayout === 'mono' ? 1 : 2,
            sampleRate: ir.sampleRate,
          })
        : new TransferableAudioWorkletClock({
            capacityFrames: ir.sampleRate * 2,
            channelCount: ir.channelLayout === 'mono' ? 1 : 2,
            sampleRate: ir.sampleRate,
          });
    this.#clock = clock;
    if (clock.context.sampleRate !== ir.sampleRate) {
      const actual = clock.context.sampleRate;
      await clock.dispose();
      if (this.#clock === clock) this.#clock = undefined;
      throw new Error(
        `AudioContext sample rate ${actual.toString()} does not match Project ${ir.sampleRate.toString()}`,
      );
    }
    try {
      await clock.initialize(1_024);
    } catch (error) {
      await clock.dispose().catch(() => undefined);
      if (this.#clock === clock) this.#clock = undefined;
      throw error;
    }
    if (this.#clock !== clock || generation !== this.#generation || this.#state === 'disposed') {
      await clock.dispose();
      if (this.#clock === clock) this.#clock = undefined;
      throw new DOMException('Player runtime initialization became stale', 'AbortError');
    }
    this.#scheduler = new AudioDrivenVideoScheduler({
      clock,
      frameRate: ir.frameRate,
      durationUs: ir.durationUs,
      onFrame: scheduled => this.#renderScheduled(scheduled),
      onError: error => this.#failRuntime(error),
      onEnd: () => {
        this.#state = 'ended';
        this.#lastTimeUs = ir.durationUs;
        if (this.#fillHandle !== undefined) {
          globalThis.clearInterval(this.#fillHandle);
          this.#fillHandle = undefined;
        }
        void this.#clock?.pause().catch((error: unknown) => this.#failRuntime(error));
        this.#session.notifyStatsChanged();
      },
    });
  }

  #requestAudioFill(observeFailure: boolean): Promise<void> {
    const existing = this.#fillTask;
    if (existing !== undefined) {
      if (this.#fillGeneration === this.#generation) return existing;
      const next = existing.then(
        () => this.#requestAudioFill(observeFailure),
        () => this.#requestAudioFill(observeFailure),
      );
      if (!observeFailure) void next.catch((error: unknown) => this.#failRuntime(error));
      return next;
    }
    const clock = this.#clock;
    if (clock === undefined) return Promise.resolve();
    const generation = this.#generation;
    const signal = this.#fillController.signal;
    const task = this.#fillAudio(clock, generation, signal).finally(() => {
      if (this.#fillTask === task) this.#fillTask = undefined;
    });
    this.#fillTask = task;
    this.#fillGeneration = generation;
    if (!observeFailure) void task.catch((error: unknown) => this.#failRuntime(error));
    return task;
  }

  async #fillAudio(clock: Clock, generation: number, signal: AbortSignal): Promise<void> {
    const ir = this.#session.requireIr();
    const channelCount = ir.channelLayout === 'mono' ? 1 : 2;
    const totalFrames = Math.floor((ir.durationUs * ir.sampleRate) / 1_000_000);
    while (this.#nextAudioFrame < totalFrames) {
      if (!this.#runtimeCurrent(clock, generation, signal)) return;
      const snapshot =
        clock instanceof AudioWorkletClock ? clock.ring.snapshot() : clock.snapshot();
      const startFrame = this.#nextAudioFrame;
      const frameCount = Math.min(4_096, snapshot.availableWriteFrames, totalFrames - startFrame);
      if (frameCount <= 0) break;
      const pcm = await renderIrAudio({
        ir,
        startFrame,
        frameCount,
        channelCount,
        source: this.#session.requireMedia(),
        signal,
      });
      if (!this.#runtimeCurrent(clock, generation, signal)) return;
      const accepted =
        clock instanceof AudioWorkletClock
          ? clock.ring.writeInterleaved(pcm) === frameCount
          : clock.enqueueInterleaved(pcm);
      if (!accepted) break;
      if (this.#nextAudioFrame !== startFrame) return;
      this.#nextAudioFrame = startFrame + frameCount;
    }
  }

  async #renderScheduled(scheduled: ScheduledVideoFrame): Promise<void> {
    const signal = this.#videoController.signal;
    const result = await this.#session.preview.renderFrame({
      timeUs: scheduled.timestampUs,
      signal,
    });
    if (signal.aborted || scheduled.generation !== this.#scheduler?.generation) {
      result.bitmap.close();
      return;
    }
    this.#publish(scheduled, result);
  }

  #publish(
    scheduled: Pick<
      ScheduledVideoFrame,
      'generation' | 'frameIndex' | 'timestampUs' | 'droppedFrames'
    >,
    result: Awaited<ReturnType<AelionSession['renderFrame']>>,
  ): void {
    this.#lastTimeUs = scheduled.timestampUs;
    this.#renderedFrames += 1;
    this.#droppedFrames += scheduled.droppedFrames;
    this.#session.notifyStatsChanged();
    if (this.#listeners.size === 0) {
      result.bitmap.close();
      return;
    }
    const event = { ...scheduled, result };
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        result.bitmap.close();
        this.#failRuntime(error);
        return;
      }
    }
  }

  #disposeRuntime(): Promise<void> {
    const existing = this.#runtimeDisposeTask;
    if (existing !== undefined) return existing;
    const task = this.#disposeRuntimeOnce().finally(() => {
      if (this.#runtimeDisposeTask === task) this.#runtimeDisposeTask = undefined;
    });
    this.#runtimeDisposeTask = task;
    return task;
  }

  async #disposeRuntimeOnce(): Promise<void> {
    if (this.#fillHandle !== undefined) {
      globalThis.clearInterval(this.#fillHandle);
      this.#fillHandle = undefined;
    }
    const scheduler = this.#scheduler;
    const initializingClock = this.#clock;
    scheduler?.dispose();
    await this.#runtimeInitTask?.catch(() => undefined);
    const clock = this.#clock ?? initializingClock;
    this.#clock = undefined;
    await clock?.dispose();
    await this.#fillTask?.catch(() => undefined);
    this.#fillTask = undefined;
    this.#fillGeneration = -1;
    this.#scheduler = undefined;
    if (scheduler !== undefined || clock !== undefined) {
      const transport =
        clock instanceof AudioWorkletClock
          ? clock.ring.snapshot()
          : clock instanceof TransferableAudioWorkletClock
            ? clock.snapshot()
            : undefined;
      this.#lastDisposedRuntime = Object.freeze({
        schedulerDisposed: scheduler?.snapshot().disposed ?? true,
        audioDisposed: clock?.disposed ?? true,
        audioContextClosed:
          clock === undefined || !clock.ownsContext || clock.context.state === 'closed',
        transportClosed:
          transport === undefined
            ? true
            : 'state' in transport
              ? transport.state === 'closed'
              : transport.closed,
        bufferedFrames:
          transport === undefined
            ? 0
            : 'availableReadFrames' in transport
              ? transport.availableReadFrames
              : transport.queuedFrames,
      });
    }
  }

  #advanceGeneration(): void {
    this.#generation += 1;
    this.#scheduler?.seek();
    this.#fillController.abort(new DOMException('Player generation changed', 'AbortError'));
    this.#videoController.abort(new DOMException('Player generation changed', 'AbortError'));
    this.#fillController = new AbortController();
    this.#videoController = new AbortController();
  }

  #runtimeCurrent(clock: Clock, generation: number, signal: AbortSignal): boolean {
    return (
      !signal.aborted &&
      this.#state !== 'disposed' &&
      this.#clock === clock &&
      this.#generation === generation
    );
  }

  #playContinuationCurrent(generation: number): boolean {
    return this.#disposeTask === undefined && generation === this.#generation;
  }

  #failRuntime(error: unknown): void {
    if (this.#state === 'disposed') return;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error !== null && typeof error === 'object') {
      const diagnostics: unknown = Reflect.get(error, 'diagnostics');
      if (
        Array.isArray(diagnostics) &&
        diagnostics.some(
          value =>
            value !== null &&
            typeof value === 'object' &&
            Reflect.get(value, 'code') === 'OPERATION_ABORTED',
        )
      ) {
        return;
      }
    }
    const failureTimeUs = this.currentTimeUs;
    this.#errors += 1;
    this.#lastErrorCode = runtimeErrorCode(error);
    this.#state = 'error';
    this.#lastTimeUs = failureTimeUs;
    this.#scheduler?.pause();
    if (this.#fillHandle !== undefined) {
      globalThis.clearInterval(this.#fillHandle);
      this.#fillHandle = undefined;
    }
    this.#fillController.abort(error);
    void this.#clock?.pause().catch(() => undefined);
    try {
      this.#onRuntimeError?.(error);
    } catch {
      // Error reporting cannot create a second unhandled runtime failure.
    }
    this.#session.notifyStatsChanged();
  }
}
