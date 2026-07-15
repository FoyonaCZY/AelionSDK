export interface MeasuredLongTask {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly durationMs: number;
  readonly overlapMs: number;
}

export interface LongTaskWindow {
  readonly supported: boolean;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly elapsedMs: number;
  readonly tasks: readonly MeasuredLongTask[];
  readonly longTasksOver50Ms: number | null;
  readonly maxLongTaskMs: number | null;
}

interface RawLongTask {
  readonly startTimeMs: number;
  readonly durationMs: number;
}

interface LongTaskMeasurementDependencies {
  readonly now?: () => number;
  readonly nextTask?: () => Promise<void>;
  readonly createObserver?: (callback: PerformanceObserverCallback) => PerformanceObserver;
}

function appendEntries(target: RawLongTask[], entries: PerformanceEntryList): void {
  for (const entry of entries) {
    if (entry.entryType === 'longtask') {
      target.push({ startTimeMs: entry.startTime, durationMs: entry.duration });
    }
  }
}

function windowTasks(
  entries: readonly RawLongTask[],
  startedAtMs: number,
  completedAtMs: number,
): readonly MeasuredLongTask[] {
  return entries.flatMap(entry => {
    const endTimeMs = entry.startTimeMs + entry.durationMs;
    if (entry.startTimeMs >= completedAtMs || endTimeMs <= startedAtMs) return [];
    return [
      {
        ...entry,
        endTimeMs,
        overlapMs: Math.min(endTimeMs, completedAtMs) - Math.max(entry.startTimeMs, startedAtMs),
      },
    ];
  });
}

export function sliceLongTaskWindow(
  window: LongTaskWindow,
  startedAtMs: number,
  completedAtMs: number,
): LongTaskWindow {
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(completedAtMs) ||
    startedAtMs < window.startedAtMs ||
    completedAtMs > window.completedAtMs ||
    completedAtMs < startedAtMs
  ) {
    throw new RangeError('Long Task sub-window must be inside its measured parent window');
  }
  const tasks = windowTasks(window.tasks, startedAtMs, completedAtMs);
  return {
    supported: window.supported,
    startedAtMs,
    completedAtMs,
    elapsedMs: completedAtMs - startedAtMs,
    tasks,
    longTasksOver50Ms: window.supported ? tasks.filter(task => task.durationMs > 50).length : null,
    maxLongTaskMs: window.supported ? Math.max(0, ...tasks.map(task => task.durationMs)) : null,
  };
}

export async function measureLongTasksDuring<T>(
  operation: () => T | PromiseLike<T>,
  dependencies: LongTaskMeasurementDependencies = {},
): Promise<{ readonly value: T; readonly window: LongTaskWindow }> {
  const now = dependencies.now ?? (() => performance.now());
  const nextTask =
    dependencies.nextTask ??
    (() => new Promise<void>(resolve => globalThis.setTimeout(resolve, 0)));
  const createObserver =
    dependencies.createObserver ?? (callback => new PerformanceObserver(callback));
  const entries: RawLongTask[] = [];
  let observer: PerformanceObserver | undefined;
  try {
    observer = createObserver(list => appendEntries(entries, list.getEntries()));
    observer.observe({ type: 'longtask' });
  } catch {
    observer?.disconnect();
    observer = undefined;
  }

  if (observer !== undefined) {
    await nextTask();
    entries.length = 0;
    observer.takeRecords();
  }
  const startedAtMs = now();
  let value!: T;
  let failed = false;
  let failure: unknown;
  try {
    value = await operation();
  } catch (error) {
    failed = true;
    failure = error;
  }
  const completedAtMs = now();

  if (observer !== undefined) {
    try {
      await nextTask();
      appendEntries(entries, observer.takeRecords());
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    } finally {
      observer.disconnect();
    }
  }
  if (failed) throw failure;

  const tasks = windowTasks(entries, startedAtMs, completedAtMs);
  const supported = observer !== undefined;
  return {
    value,
    window: {
      supported,
      startedAtMs,
      completedAtMs,
      elapsedMs: completedAtMs - startedAtMs,
      tasks,
      longTasksOver50Ms: supported ? tasks.filter(task => task.durationMs > 50).length : null,
      maxLongTaskMs: supported ? Math.max(0, ...tasks.map(task => task.durationMs)) : null,
    },
  };
}
