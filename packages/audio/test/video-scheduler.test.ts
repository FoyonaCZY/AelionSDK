import { describe, expect, it } from 'vitest';

import { AudioDrivenVideoScheduler, type ScheduledVideoFrame } from '../src/index.js';

describe('AudioDrivenVideoScheduler', () => {
  it('derives video frames from the audio clock and drops stale frame intervals', async () => {
    let timeUs = 0;
    let nextHandle = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    const frames: ScheduledVideoFrame[] = [];
    const scheduler = new AudioDrivenVideoScheduler({
      clock: { nowUs: () => timeUs },
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
      onFrame: frame => {
        frames.push(frame);
      },
      schedule: callback => {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel: handle => {
        callbacks.delete(handle);
      },
    });
    const step = (): void => {
      const entry = callbacks.entries().next().value;
      if (entry === undefined) throw new Error('Scheduler did not request a tick');
      callbacks.delete(entry[0]);
      entry[1](performance.now());
    };

    scheduler.start();
    expect(scheduler.snapshot()).toMatchObject({
      disposed: false,
      scheduled: true,
      rendering: false,
      ended: false,
    });
    step();
    await Promise.resolve();
    timeUs = 100_000;
    step();
    await Promise.resolve();

    expect(frames).toEqual([
      { generation: 0, frameIndex: 0, timestampUs: 0, droppedFrames: 0 },
      { generation: 0, frameIndex: 3, timestampUs: 100_000, droppedFrames: 2 },
    ]);
    scheduler.dispose();
    expect(callbacks.size).toBe(0);
    expect(scheduler.snapshot()).toMatchObject({
      disposed: true,
      scheduled: false,
      rendering: false,
    });
  });

  it('increments generation so late frames from before a seek can be discarded', async () => {
    let timeUs = 500_000;
    let callback: FrameRequestCallback | undefined;
    const frames: ScheduledVideoFrame[] = [];
    const scheduler = new AudioDrivenVideoScheduler({
      clock: { nowUs: () => timeUs },
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
      onFrame: frame => {
        frames.push(frame);
      },
      schedule: value => {
        callback = value;
        return 1;
      },
      cancel: () => undefined,
    });
    scheduler.start();
    callback?.(0);
    await Promise.resolve();
    timeUs = 100_000;
    expect(scheduler.seek()).toBe(1);
    callback?.(0);
    await Promise.resolve();

    expect(frames.map(frame => [frame.generation, frame.frameIndex])).toEqual([
      [0, 15],
      [1, 3],
    ]);
    scheduler.dispose();
  });
});

describe('AudioDrivenVideoScheduler end state', () => {
  it('stops scheduling and emits end once when the audio clock reaches duration', () => {
    let nowUs = 0;
    let callback: FrameRequestCallback | undefined;
    let ended = 0;
    const scheduler = new AudioDrivenVideoScheduler({
      clock: { nowUs: () => nowUs },
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
      onFrame: () => undefined,
      onEnd: () => {
        ended += 1;
      },
      schedule: next => {
        callback = next;
        return 1;
      },
      cancel: () => undefined,
    });
    scheduler.start();
    nowUs = 1_000_000;
    callback?.(0);
    expect(ended).toBe(1);
    scheduler.dispose();
  });

  it('reports rejected frame work without creating an unhandled rejection', async () => {
    let callback: FrameRequestCallback | undefined;
    const failure = new Error('render failed');
    const errors: unknown[] = [];
    const scheduler = new AudioDrivenVideoScheduler({
      clock: { nowUs: () => 0 },
      frameRate: { numerator: 30, denominator: 1 },
      durationUs: 1_000_000,
      onFrame: () => Promise.reject(failure),
      onError: error => errors.push(error),
      schedule: next => {
        callback = next;
        return 1;
      },
      cancel: () => undefined,
    });

    scheduler.start();
    callback?.(0);
    await Promise.resolve();

    expect(errors).toEqual([failure]);
    scheduler.dispose();
  });
});
