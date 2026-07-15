import type { WebMExportResult } from '@aelion/export';

import type { AelionExportJob, AelionExportJobSnapshot, AelionExportJobState } from './types.js';

export interface AelionExportJobOptions {
  readonly id: string;
  readonly externalSignal?: AbortSignal;
  readonly run: (
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ) => Promise<WebMExportResult>;
  readonly onSnapshot?: (snapshot: AelionExportJobSnapshot) => void;
  readonly onSettled?: (job: AelionExportJob) => void;
}

function boundedProgress(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error === null || typeof error !== 'object') return false;
  const diagnostics: unknown = Reflect.get(error, 'diagnostics');
  return (
    Array.isArray(diagnostics) &&
    diagnostics.some(
      value =>
        value !== null &&
        typeof value === 'object' &&
        Reflect.get(value, 'code') === 'OPERATION_ABORTED',
    )
  );
}

export class ExportJob extends Promise<WebMExportResult> implements AelionExportJob {
  readonly #id: string;
  readonly #controller = new AbortController();
  readonly #listeners = new Set<(snapshot: AelionExportJobSnapshot) => void>();
  readonly #onSnapshot: AelionExportJobOptions['onSnapshot'];
  #state: AelionExportJobState = 'running';
  #progress = 0;
  #result!: Promise<WebMExportResult>;
  #detachExternalSignal: (() => void) | undefined;

  public constructor(options: AelionExportJobOptions) {
    // The native Promise backing this subclass deliberately stays pending. All
    // Promise methods delegate to #result, which avoids a second rejection that
    // could otherwise become unhandled while preserving await compatibility.
    super(() => undefined);
    this.#id = options.id;
    this.#onSnapshot = options.onSnapshot;

    const externalSignal = options.externalSignal;
    if (externalSignal !== undefined) {
      const abort = (): void => this.#controller.abort(externalSignal.reason);
      if (externalSignal.aborted) abort();
      else {
        externalSignal.addEventListener('abort', abort, { once: true });
        this.#detachExternalSignal = () => externalSignal.removeEventListener('abort', abort);
      }
    }

    const operation = Promise.resolve().then(() =>
      options.run(this.#controller.signal, progress => this.#setProgress(progress)),
    );
    this.#result = operation.then(
      value => {
        this.#state = 'completed';
        this.#progress = 1;
        this.#notify();
        return value;
      },
      (error: unknown) => {
        this.#state = isAbort(error, this.#controller.signal) ? 'cancelled' : 'failed';
        this.#notify();
        throw error;
      },
    );
    void this.#result.catch(() => undefined);
    void this.#result.then(
      () => this.#settled(options),
      () => this.#settled(options),
    );
  }

  public get id(): string {
    return this.#id;
  }

  public get state(): AelionExportJobState {
    return this.#state;
  }

  public get result(): Promise<WebMExportResult> {
    return this.#result;
  }

  public override then<TResult1 = WebMExportResult, TResult2 = never>(
    onfulfilled?: ((value: WebMExportResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#result.then(onfulfilled, onrejected);
  }

  public override catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<WebMExportResult | TResult> {
    return this.#result.catch(onrejected);
  }

  public override finally(onfinally?: (() => void) | null): Promise<WebMExportResult> {
    return this.#result.finally(onfinally);
  }

  public async cancel(reason: unknown = new DOMException('Export cancelled', 'AbortError')) {
    if (this.#state !== 'running') return;
    this.#controller.abort(reason);
    try {
      await this.#result;
    } catch {
      // Cancellation observes cleanup completion; callers consume failures through `result`.
    }
  }

  public getSnapshot(): AelionExportJobSnapshot {
    return Object.freeze({ id: this.#id, state: this.#state, progress: this.#progress });
  }

  public subscribe(listener: (snapshot: AelionExportJobSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setProgress(value: number): void {
    if (this.#state !== 'running') return;
    const progress = boundedProgress(value);
    if (progress === this.#progress) return;
    this.#progress = progress;
    this.#notify();
  }

  #notify(): void {
    const snapshot = this.getSnapshot();
    try {
      this.#onSnapshot?.(snapshot);
    } catch {
      // Observer failures cannot change the export result.
    }
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Observer failures cannot change the export result or other listeners.
      }
    }
    if (this.#state !== 'running') this.#listeners.clear();
  }

  #settled(options: AelionExportJobOptions): void {
    this.#detachExternalSignal?.();
    this.#detachExternalSignal = undefined;
    options.onSettled?.(this);
  }
}
