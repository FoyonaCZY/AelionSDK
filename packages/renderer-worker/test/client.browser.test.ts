import { describe, expect, it } from 'vitest';

import type { WebGl2MaterialProgram } from '@aelion/material-compiler';

import { WorkerCompositor } from '../src/client.js';
import type { RendererWorkerRequest } from '../src/protocol.js';

class CountingAbortSignal {
  public aborted = false;
  public added = 0;
  public removed = 0;
  readonly #listeners = new Set<EventListenerOrEventListenerObject>();

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type !== 'abort' || listener === null) return;
    this.added += 1;
    this.#listeners.add(listener);
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (type !== 'abort' || listener === null) return;
    if (this.#listeners.delete(listener)) this.removed += 1;
  }

  public get listenerCount(): number {
    return this.#listeners.size;
  }
}

class ErroringWorker extends EventTarget {
  public terminated = false;
  readonly requests: RendererWorkerRequest[] = [];

  public postMessage(request: RendererWorkerRequest): void {
    this.requests.push(request);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public fail(message: string): void {
    this.dispatchEvent(new ErrorEvent('error', { message }));
    for (const request of this.requests) {
      if (request.type === 'compose') {
        Object.values(request.inputs).forEach(input => input.close());
      }
    }
  }
}

class HoldingWorker extends EventTarget {
  public terminated = false;
  readonly requests: RendererWorkerRequest[] = [];

  public postMessage(request: RendererWorkerRequest): void {
    this.requests.push(request);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public acknowledgeCancellation(id: number): void {
    this.dispatchEvent(new MessageEvent('message', { data: { type: 'cancelled', id } }));
  }
}

class ThrowingWorker extends EventTarget {
  public terminated = false;

  public postMessage(): never {
    throw new DOMException('synthetic structured clone failure', 'DataCloneError');
  }

  public terminate(): void {
    this.terminated = true;
  }
}

const minimalProgram = {
  graphHash: 'test-graph',
  inputPorts: ['source'],
  uniforms: [],
  fragmentShader: '',
} as unknown as WebGl2MaterialProgram;

function frame(): VideoFrame {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.fillStyle = 'black';
  context.fillRect(0, 0, 1, 1);
  return new VideoFrame(canvas, { timestamp: 0 });
}

describe('WorkerCompositor client lifecycle', () => {
  it('removes every pending abort listener when the Worker errors', async () => {
    const worker = new ErroringWorker();
    const firstSignal = new CountingAbortSignal();
    const secondSignal = new CountingAbortSignal();
    const compositor = new WorkerCompositor({
      workerFactory: () => worker as unknown as Worker,
    } as never);
    const first = compositor.compose({
      inputs: { source: frame() },
      program: minimalProgram,
      width: 1,
      height: 1,
      signal: firstSignal as unknown as AbortSignal,
    });
    const second = compositor.compose({
      inputs: { source: frame() },
      program: minimalProgram,
      width: 1,
      height: 1,
      signal: secondSignal as unknown as AbortSignal,
    });

    expect(firstSignal.listenerCount).toBe(1);
    expect(secondSignal.listenerCount).toBe(1);
    worker.fail('synthetic Worker failure');

    await expect(first).rejects.toThrow('synthetic Worker failure');
    await expect(second).rejects.toThrow('synthetic Worker failure');
    expect(firstSignal.listenerCount).toBe(0);
    expect(secondSignal.listenerCount).toBe(0);
    expect(firstSignal.removed).toBe(firstSignal.added);
    expect(secondSignal.removed).toBe(secondSignal.added);
    expect(compositor.snapshot().pendingRequests).toBe(0);
    expect(compositor.disposed).toBe(true);
    await expect(
      compositor.compose({
        inputs: { source: frame() },
        program: minimalProgram,
        width: 1,
        height: 1,
      }),
    ).rejects.toThrow('disposed');

    compositor.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('retains admission for a cancelled request until the Worker cleanup acknowledgement', async () => {
    const worker = new HoldingWorker();
    const compositor = new WorkerCompositor({
      maxPendingRequests: 1,
      workerFactory: () => worker as unknown as Worker,
    } as never);
    const controller = new AbortController();
    const cancelled = compositor.compose({
      inputs: { source: frame() },
      program: minimalProgram,
      width: 1,
      height: 1,
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    expect(compositor.snapshot()).toMatchObject({
      pendingRequests: 1,
      activeRequests: 0,
      cancelledRequests: 1,
      maxPendingRequests: 1,
    });
    await expect(
      compositor.compose({
        inputs: { source: frame() },
        program: minimalProgram,
        width: 1,
        height: 1,
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'RENDERER_QUEUE_FULL' })],
    });
    expect(worker.requests.map(request => request.type)).toEqual(['compose', 'cancel']);

    worker.acknowledgeCancellation(1);
    expect(compositor.snapshot()).toMatchObject({
      pendingRequests: 0,
      activeRequests: 0,
      cancelledRequests: 0,
    });
    compositor.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('keeps repeated cancel-and-retry traffic bounded by Worker acknowledgements', async () => {
    const worker = new HoldingWorker();
    const compositor = new WorkerCompositor({
      maxPendingRequests: 1,
      workerFactory: () => worker as unknown as Worker,
    } as never);

    for (let id = 1; id <= 100; id += 1) {
      const controller = new AbortController();
      const cancelled = compositor.compose({
        inputs: { source: frame() },
        program: minimalProgram,
        width: 1,
        height: 1,
        signal: controller.signal,
      });
      controller.abort();
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      expect(compositor.snapshot().pendingRequests).toBe(1);
      worker.acknowledgeCancellation(id);
      expect(compositor.snapshot().pendingRequests).toBe(0);
    }

    expect(worker.requests.filter(request => request.type === 'compose')).toHaveLength(100);
    expect(worker.requests.filter(request => request.type === 'cancel')).toHaveLength(100);
    compositor.dispose();
  });

  it('drains admission and closes caller inputs when request transfer throws', async () => {
    const worker = new ThrowingWorker();
    const compositor = new WorkerCompositor({
      workerFactory: () => worker as unknown as Worker,
    } as never);
    const input = frame();

    await expect(
      compositor.compose({
        inputs: { source: input },
        program: minimalProgram,
        width: 1,
        height: 1,
      }),
    ).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(input.format).toBeNull();
    expect(compositor.snapshot().pendingRequests).toBe(0);
    expect(compositor.disposed).toBe(true);

    expect(() => compositor.dispose()).not.toThrow();
    expect(worker.terminated).toBe(true);
  });
});
