import { describe, expect, it } from 'vitest';

import { DisposableStack, ResourceTracker } from '../src/index.js';

describe('resource ownership', () => {
  it('disposes resources in reverse ownership order exactly once', async () => {
    const order: number[] = [];
    const stack = new DisposableStack();
    stack.defer(() => {
      order.push(1);
    });
    stack.defer(() => {
      order.push(2);
    });

    await stack.dispose();
    await stack.dispose();

    expect(order).toEqual([2, 1]);
  });

  it('makes concurrent disposal await the same asynchronous cleanup', async () => {
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => {
      release = resolve;
    });
    const stack = new DisposableStack();
    stack.defer(() => cleanup);

    const first = stack.dispose();
    const second = stack.dispose();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
  });

  it('tracks and releases owned resources idempotently', () => {
    const tracker = new ResourceTracker();
    const releaseFrame = tracker.acquire('video-frame');
    const releaseTexture = tracker.acquire('gpu-texture');

    expect(tracker.snapshot()).toEqual({
      counts: { 'gpu-texture': 1, 'video-frame': 1 },
      total: 2,
    });

    releaseFrame();
    releaseFrame();
    releaseTexture();
    expect(() => tracker.assertReleased()).not.toThrow();
  });
});
