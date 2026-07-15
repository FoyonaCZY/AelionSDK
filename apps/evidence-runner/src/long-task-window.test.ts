import { describe, expect, it } from 'vitest';

import { measureLongTasksDuring, sliceLongTaskWindow } from './long-task-window.js';

interface EntryValue {
  readonly entryType: string;
  readonly startTime: number;
  readonly duration: number;
}

function entry(startTime: number, duration: number): EntryValue {
  return { entryType: 'longtask', startTime, duration };
}

class FakeObserver {
  readonly #callback: PerformanceObserverCallback;
  readonly pending: EntryValue[] = [];
  disconnectCalls = 0;

  public constructor(callback: PerformanceObserverCallback) {
    this.#callback = callback;
  }

  public observe(): void {
    // Fake observer registration is intentionally synchronous.
  }

  public takeRecords(): PerformanceEntryList {
    return this.pending.splice(0) as PerformanceEntryList;
  }

  public disconnect(): void {
    this.disconnectCalls += 1;
  }

  public deliver(...values: EntryValue[]): void {
    this.#callback(
      { getEntries: () => values as PerformanceEntryList } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

describe('Long Task measurement window', () => {
  it('drops pre-window records and retains callback and terminal records that overlap the operation', async () => {
    let observer!: FakeObserver;
    let nowCalls = 0;
    let nextTaskCalls = 0;
    const measured = await measureLongTasksDuring(
      () => {
        observer.deliver(entry(10, 51));
        observer.pending.push(entry(19, 2), entry(20, 100));
        return 'result';
      },
      {
        now: () => (nowCalls++ === 0 ? 10 : 20),
        nextTask: () => {
          nextTaskCalls += 1;
          if (nextTaskCalls === 1) {
            observer.deliver(entry(0, 100));
            observer.pending.push(entry(0, 100));
          } else {
            observer.pending.push(entry(5, 5), entry(8, 2), entry(20, 100));
          }
          return Promise.resolve();
        },
        createObserver: callback => {
          observer = new FakeObserver(callback);
          return observer as unknown as PerformanceObserver;
        },
      },
    );

    expect(measured.value).toBe('result');
    expect(measured.window).toMatchObject({
      supported: true,
      startedAtMs: 10,
      completedAtMs: 20,
      elapsedMs: 10,
      longTasksOver50Ms: 1,
      maxLongTaskMs: 51,
    });
    expect(measured.window.tasks).toEqual([
      { startTimeMs: 10, endTimeMs: 61, durationMs: 51, overlapMs: 10 },
      { startTimeMs: 19, endTimeMs: 21, durationMs: 2, overlapMs: 1 },
    ]);
    expect(observer.disconnectCalls).toBe(1);
  });

  it('reports unsupported observers explicitly instead of claiming zero Long Tasks', async () => {
    const measured = await measureLongTasksDuring(() => 1, {
      now: () => 0,
      createObserver: () => {
        throw new Error('unsupported');
      },
    });
    expect(measured.window).toMatchObject({
      supported: false,
      longTasksOver50Ms: null,
      maxLongTaskMs: null,
    });
  });

  it('disconnects exactly once and preserves the operation failure', async () => {
    const failure = new Error('operation failed');
    let observer!: FakeObserver;
    let nextTaskCalls = 0;
    await expect(
      measureLongTasksDuring(
        () => {
          throw failure;
        },
        {
          now: () => 0,
          nextTask: () => {
            nextTaskCalls += 1;
            return nextTaskCalls === 2
              ? Promise.reject(new Error('drain failed'))
              : Promise.resolve();
          },
          createObserver: callback => {
            observer = new FakeObserver(callback);
            return observer as unknown as PerformanceObserver;
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(observer.disconnectCalls).toBe(1);
  });

  it('classifies initialization and steady-state tasks without losing boundary overlaps', () => {
    const parent = {
      supported: true,
      startedAtMs: 10,
      completedAtMs: 100,
      elapsedMs: 90,
      tasks: [
        { startTimeMs: 10, endTimeMs: 60, durationMs: 50, overlapMs: 50 },
        { startTimeMs: 60, endTimeMs: 111, durationMs: 51, overlapMs: 40 },
      ],
      longTasksOver50Ms: 1,
      maxLongTaskMs: 51,
    };
    expect(sliceLongTaskWindow(parent, 10, 60)).toMatchObject({
      tasks: [{ startTimeMs: 10, endTimeMs: 60, durationMs: 50, overlapMs: 50 }],
      longTasksOver50Ms: 0,
    });
    expect(sliceLongTaskWindow(parent, 60, 100)).toMatchObject({
      tasks: [{ startTimeMs: 60, endTimeMs: 111, durationMs: 51, overlapMs: 40 }],
      longTasksOver50Ms: 1,
    });
    expect(() => sliceLongTaskWindow(parent, 0, 100)).toThrow(RangeError);
  });
});
