import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioWorkletClock, TransferableAudioWorkletClock } from '../src/index.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value?: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = value => resolvePromise(value as T);
  });
  return { promise, resolve };
}

class FakeMessagePort extends EventTarget {
  public started = false;
  public closed = false;

  public start(): void {
    this.started = true;
  }

  public close(): void {
    this.closed = true;
  }

  public postMessage(): void {
    // Message payloads are intentionally ignored by this lifecycle-only fake.
  }
}

class FakeAudioWorkletNode {
  public static readonly instances: FakeAudioWorkletNode[] = [];
  public readonly port = new FakeMessagePort();
  public connected = false;
  public disconnected = false;

  public constructor() {
    FakeAudioWorkletNode.instances.push(this);
  }

  public connect(): void {
    this.connected = true;
  }

  public disconnect(): void {
    this.disconnected = true;
    this.connected = false;
  }
}

class FakeAudioContext extends EventTarget {
  public readonly sampleRate = 48_000;
  public readonly currentTime = 0;
  public readonly destination = {};
  public state: AudioContextState = 'suspended';
  public addModuleCalls = 0;
  public readonly moduleGate = deferred<undefined>();
  public readonly audioWorklet = {
    addModule: (): Promise<void> => {
      this.addModuleCalls += 1;
      return this.moduleGate.promise;
    },
  };

  public resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  public suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

type Clock = AudioWorkletClock | TransferableAudioWorkletClock;

function clock(mode: 'shared-ring' | 'transferable-queue', context: FakeAudioContext): Clock {
  return mode === 'shared-ring'
    ? new AudioWorkletClock({ context: context as unknown as AudioContext })
    : new TransferableAudioWorkletClock({ context: context as unknown as AudioContext });
}

describe('AudioWorklet clock initialization lifecycle', () => {
  beforeEach(async () => {
    await vi.dynamicImportSettled();
    FakeAudioWorkletNode.instances.length = 0;
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['shared-ring', 'transferable-queue'] as const)(
    'single-flights concurrent %s initialization',
    async mode => {
      const context = new FakeAudioContext();
      const instance = clock(mode, context);
      expect(instance.ownsContext).toBe(false);
      const first = instance.initialize(1_024);
      const second = instance.initialize(1_024);

      expect(context.addModuleCalls).toBe(1);
      expect(FakeAudioWorkletNode.instances).toHaveLength(0);
      context.moduleGate.resolve();
      await Promise.all([first, second]);

      expect(FakeAudioWorkletNode.instances).toHaveLength(1);
      expect(FakeAudioWorkletNode.instances[0]).toMatchObject({
        connected: true,
        disconnected: false,
      });
      await instance.dispose();
      expect(FakeAudioWorkletNode.instances[0]).toMatchObject({
        connected: false,
        disconnected: true,
      });
    },
  );

  it.each(['shared-ring', 'transferable-queue'] as const)(
    'does not create an orphan %s node when disposed during initialization',
    async mode => {
      const context = new FakeAudioContext();
      const instance = clock(mode, context);
      const initialization = instance.initialize(1_024);

      const disposal = instance.dispose();
      context.moduleGate.resolve();
      await Promise.all([
        expect(initialization).rejects.toMatchObject({ name: 'AbortError' }),
        disposal,
      ]);
      expect(FakeAudioWorkletNode.instances).toHaveLength(0);
      expect(context.state).toBe('suspended');
    },
  );

  it.each(['shared-ring', 'transferable-queue'] as const)(
    'makes concurrent %s disposal wait for the same in-flight cleanup',
    async mode => {
      const context = new FakeAudioContext();
      const instance = clock(mode, context);
      const initialization = instance.initialize(1_024);
      const first = instance.dispose();
      const second = instance.dispose();
      let secondSettled = false;
      void second.then(() => {
        secondSettled = true;
      });

      await Promise.resolve();
      expect(secondSettled).toBe(false);
      context.moduleGate.resolve();
      await Promise.all([
        expect(initialization).rejects.toMatchObject({ name: 'AbortError' }),
        first,
        second,
      ]);
      expect(instance.disposed).toBe(true);
      expect(secondSettled).toBe(true);
    },
  );

  it('bounds a hung transferable AudioWorklet module load', async () => {
    vi.useFakeTimers();
    try {
      const context = new FakeAudioContext();
      const instance = clock('transferable-queue', context);
      const initialization = instance.initialize(1_024);
      const disposal = instance.dispose();
      const initializationExpectation = expect(initialization).rejects.toThrow('timed out');
      const disposalExpectation = expect(disposal).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.all([initializationExpectation, disposalExpectation]);
      expect(instance.disposed).toBe(true);
      expect(FakeAudioWorkletNode.instances).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
