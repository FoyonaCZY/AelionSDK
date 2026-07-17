import type { RenderIrFrameResult } from '@aelion/renderer-worker';
import { describe, expect, it, vi } from 'vitest';

import { attachPreviewCanvas } from '../src/preview-controller.js';
import type { AelionPlayerFrame, AelionSessionApi } from '../src/types.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function canvas(): {
  readonly element: HTMLCanvasElement;
  readonly drawImage: ReturnType<typeof vi.fn>;
} {
  const drawImage = vi.fn();
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  const element = {
    width: 0,
    height: 0,
    clientWidth: 320,
    clientHeight: 180,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { element, drawImage };
}

function result(close = vi.fn()): RenderIrFrameResult {
  return {
    bitmap: { close } as unknown as ImageBitmap,
    backend: 'webgl2',
    materialIds: [],
    width: 320,
    height: 180,
    renderScale: 1,
  };
}

function session(renderFrame: AelionSessionApi['preview']['renderFrame']): {
  readonly api: AelionSessionApi;
  readonly quality: ReturnType<typeof vi.fn>;
  readonly playerListener: () => ((frame: AelionPlayerFrame) => void) | undefined;
} {
  let listener: ((frame: AelionPlayerFrame) => void) | undefined;
  const quality = vi.fn();
  const api = {
    preview: { renderFrame },
    player: {
      state: 'paused',
      currentTimeUs: 0,
      setPreviewQuality: quality,
      subscribe: (next: (frame: AelionPlayerFrame) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      play: () => Promise.resolve(),
      pause: () => Promise.resolve(),
    },
    getSnapshot: () => ({ renderIr: { width: 320, height: 180 } }),
  } as unknown as AelionSessionApi;
  return { api, quality, playerListener: () => listener };
}

describe('PreviewCanvasController', () => {
  it('cancels superseded scrubs and closes every owned bitmap', async () => {
    const requests: Deferred<RenderIrFrameResult>[] = [];
    const fake = session(options => {
      const request = deferred<RenderIrFrameResult>();
      options.signal?.addEventListener(
        'abort',
        () => request.reject(new DOMException('superseded', 'AbortError')),
        { once: true },
      );
      requests.push(request);
      return request.promise;
    });
    const target = canvas();
    const controller = attachPreviewCanvas(fake.api, target.element, {
      subscribePlayer: false,
      pixelRatio: 1,
    });

    const first = controller.render(0);
    const second = controller.render(1_000);
    const close = vi.fn();
    requests[1]?.resolve(result(close));
    await Promise.all([first, second]);

    expect(target.drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({
      pending: false,
      currentTimeUs: 1_000,
      renderedFrames: 1,
      cancelledFrames: 1,
      canvasWidth: 320,
      canvasHeight: 180,
    });
    controller.dispose();
    await expect(controller.render(0)).rejects.toThrow(/disposed/u);
  });

  it('degrades adaptive Player quality after repeated dropped frames', () => {
    const fake = session(() => Promise.reject(new Error('not used')));
    const target = canvas();
    const controller = attachPreviewCanvas(fake.api, target.element, {
      pixelRatio: 1,
      quality: 'adaptive',
    });
    const listener = fake.playerListener();
    if (listener === undefined) throw new Error('Player listener was not installed');

    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      listener({
        generation: 1,
        frameIndex,
        timestampUs: frameIndex * 33_333,
        droppedFrames: 1,
        result: result(),
      });
    }

    expect(controller.snapshot().renderScale).toBe(0.75);
    expect(fake.quality).toHaveBeenLastCalledWith({ quality: 'draft', renderScale: 0.75 });
    controller.dispose();
    expect(fake.playerListener()).toBeUndefined();
  });
});
