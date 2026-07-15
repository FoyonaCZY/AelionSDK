import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AelionError } from '@aelion/core';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('operation aborted', 'AbortError');
}

const media = vi.hoisted(() => ({
  createIndexCalls: 0,
  decodeAudioActive: 0,
  decodeAudioCalls: 0,
  decodeAudioMaxActive: 0,
  decodeAudioReleases: [] as (() => void)[],
  decodeVideoActive: 0,
  decodeVideoCalls: 0,
  decodeVideoMaxActive: 0,
  decodeVideoReleases: [] as (() => void)[],
  indexGates: [] as {
    readonly signal?: AbortSignal;
    readonly resolve: () => void;
    readonly reject: (reason: unknown) => void;
  }[],
}));

function mockIndex(): import('@aelion/media').SampleIndex {
  return {
    schemaVersion: '1.0.0',
    container: 'unknown',
    durationUs: 1,
    tracks: [],
    capabilities: {
      timingAndSize: true,
      rawDecodeTimestamps: false,
      byteOffsets: false,
    },
    samples: {},
    presentationOrder: {},
    diagnostics: [],
  };
}

vi.mock('@aelion/media', () => ({
  createSampleIndex: (
    _bytes: Uint8Array,
    options: import('@aelion/media').MediaProbeOptions = {},
  ) => {
    media.createIndexCalls += 1;
    return new Promise<import('@aelion/media').SampleIndex>((resolve, reject) => {
      const finish = (): void => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve(mockIndex());
      };
      const onAbort = (): void => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException('index aborted', 'AbortError'),
        );
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      media.indexGates.push({
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        resolve: finish,
        reject,
      });
    });
  },
  decodeAudioPcmRange: (
    _bytes: Uint8Array,
    _startUs: number,
    _durationUs: number,
    options: import('@aelion/media').AudioDecodeOptions = {},
  ) => {
    media.decodeAudioCalls += 1;
    media.decodeAudioActive += 1;
    media.decodeAudioMaxActive = Math.max(media.decodeAudioMaxActive, media.decodeAudioActive);
    return new Promise<import('@aelion/media').AudioPcmBlock>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        media.decodeAudioActive -= 1;
        if (error !== undefined) reject(error);
        else {
          resolve({
            sampleRate: 48_000,
            channelCount: 2,
            startUs: 0,
            durationUs: 1,
            frameCount: 1,
            interleaved: new Float32Array(2),
          });
        }
      };
      const onAbort = (): void =>
        finish(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException('audio decode aborted', 'AbortError'),
        );
      options.signal?.addEventListener('abort', onAbort, { once: true });
      media.decodeAudioReleases.push(() => finish());
    });
  },
  decodeVideoFrameAt: (
    _bytes: Uint8Array,
    targetUs: number,
    options: import('@aelion/media').VideoDecodeOptions = {},
  ) => {
    media.decodeVideoCalls += 1;
    media.decodeVideoActive += 1;
    media.decodeVideoMaxActive = Math.max(media.decodeVideoMaxActive, media.decodeVideoActive);
    return new Promise<import('@aelion/media').VideoDecodeResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        media.decodeVideoActive -= 1;
        if (error !== undefined) {
          reject(error);
          return;
        }
        const frame = {
          clone: () => ({ close: vi.fn() }),
          close: vi.fn(),
        } as unknown as VideoFrame;
        resolve({
          frame,
          timestampUs: targetUs,
          durationUs: 1,
          decodedPackets: 1,
          plannedPackets: 1,
          decodeStartUs: targetUs,
          targetUs,
          close: () => frame.close(),
        });
      };
      const onAbort = (): void =>
        finish(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException('video decode aborted', 'AbortError'),
        );
      options.signal?.addEventListener('abort', onAbort, { once: true });
      media.decodeVideoReleases.push(() => finish());
    });
  },
}));

import { ByteMediaProvider } from '../src/index.js';

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for ByteMediaProvider state');
}

function resetMediaMocks(): void {
  media.createIndexCalls = 0;
  media.decodeAudioActive = 0;
  media.decodeAudioCalls = 0;
  media.decodeAudioMaxActive = 0;
  media.decodeAudioReleases.length = 0;
  media.decodeVideoActive = 0;
  media.decodeVideoCalls = 0;
  media.decodeVideoMaxActive = 0;
  media.decodeVideoReleases.length = 0;
  media.indexGates.length = 0;
}

async function settleAudio(request: Promise<unknown>): Promise<void> {
  await waitFor(() => media.decodeAudioReleases.length > 0);
  releaseAll(media.decodeAudioReleases);
  await request;
}

function releaseAll(releases: (() => void)[]): void {
  while (releases.length > 0) releases.shift()?.();
}

describe.sequential('ByteMediaProvider resource bounds', () => {
  beforeEach(() => resetMediaMocks());

  it('bounds immutable asset bytes with LRU eviction', async () => {
    let resolves = 0;
    const provider = new ByteMediaProvider({
      maxCachedBytes: 6,
      resolveAssetBytes: id => {
        resolves += 1;
        return Promise.resolve(new Uint8Array(id === 'a' ? [1, 2, 3, 4] : [5, 6, 7, 8]));
      },
    });
    await settleAudio(provider.pcmRange('a', 0, 0, 1));
    await settleAudio(provider.pcmRange('b', 0, 0, 1));
    expect(provider.snapshot()).toMatchObject({
      assets: 1,
      cachedBytes: 4,
      maxCachedBytes: 6,
      activeOperations: 0,
      pendingOperations: 0,
      maxConcurrentOperations: 4,
      maxPendingOperations: 64,
      inFlightRequests: 0,
      maxInFlightRequests: 68,
      sharedOperationSubscribers: 0,
    });
    expect(resolves).toBe(2);
    provider.clear();
    expect(provider.snapshot().cachedBytes).toBe(0);
  });

  it('accounts the genuine copied byte length instead of an overrideable resolver getter', async () => {
    class MisreportingBytes extends Uint8Array {
      public override get byteLength(): number {
        return 1;
      }
    }
    const provider = new ByteMediaProvider({
      maxCachedBytes: 4,
      resolveAssetBytes: () => Promise.resolve(new MisreportingBytes(8)),
    });
    await settleAudio(provider.pcmRange('misreported', 0, 0, 1));
    expect(provider.snapshot()).toMatchObject({
      assets: 0,
      cachedBytes: 0,
      maxCachedBytes: 4,
      inFlightRequests: 0,
      activeOperations: 0,
    });
  });

  it('single-flights one asset load without coupling one caller cancellation', async () => {
    const gate = deferred<Uint8Array>();
    let resolves = 0;
    let resolverSignal: AbortSignal | undefined;
    const provider = new ByteMediaProvider({
      resolveAssetBytes: (_assetId, signal) => {
        resolves += 1;
        resolverSignal = signal;
        return gate.promise;
      },
    });
    const controller = new AbortController();
    const cancelled = provider.pcmRange('shared', 0, 0, 1, controller.signal);
    const survivor = provider.pcmRange('shared', 0, 0, 1);
    await waitFor(() => resolves === 1);
    controller.abort(new DOMException('caller cancelled', 'AbortError'));
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolverSignal?.aborted).toBe(false);
    gate.resolve(new Uint8Array([1, 2, 3, 4]));
    await settleAudio(survivor);
    expect(provider.snapshot()).toMatchObject({
      assets: 1,
      inFlightAssetLoads: 0,
      activeOperations: 0,
      pendingOperations: 0,
    });
  });

  it('aborts the resolver when its sole caller cancels and completely drains', async () => {
    let resolverSignal: AbortSignal | undefined;
    const provider = new ByteMediaProvider({
      resolveAssetBytes: (_assetId, signal) => {
        resolverSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError(signal)), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const request = provider.pcmRange('only', 0, 0, 1, controller.signal);
    await waitFor(() => resolverSignal !== undefined);
    controller.abort(new DOMException('last caller cancelled', 'AbortError'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => provider.snapshot().inFlightAssetLoads === 0);
    expect(resolverSignal?.aborted).toBe(true);
    expect(provider.snapshot()).toMatchObject({
      inFlightAssetLoads: 0,
      activeOperations: 0,
      pendingOperations: 0,
    });
  });

  it('removes many cancelled waiters behind four hung loads and drains all state', async () => {
    const signals: AbortSignal[] = [];
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 4,
      maxPendingOperations: 32,
      resolveAssetBytes: (_assetId, signal) => {
        if (signal === undefined) throw new Error('Resolver requires an internal signal');
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
        });
      },
    });
    const controllers = Array.from({ length: 24 }, () => new AbortController());
    const requests = controllers.map((controller, index) =>
      provider.pcmRange(`asset-${index.toString()}`, 0, 0, 1, controller.signal),
    );
    await waitFor(
      () =>
        provider.snapshot().activeOperations === 4 && provider.snapshot().pendingOperations === 20,
    );
    controllers.forEach(controller =>
      controller.abort(new DOMException('cancel queued stress request', 'AbortError')),
    );
    const results = await Promise.allSettled(requests);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    await waitFor(
      () =>
        provider.snapshot().activeOperations === 0 && provider.snapshot().inFlightAssetLoads === 0,
    );
    expect(signals).toHaveLength(4);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(provider.snapshot()).toMatchObject({
      inFlightAssetLoads: 0,
      activeOperations: 0,
      pendingOperations: 0,
      inFlightRequests: 0,
      sharedOperationSubscribers: 0,
    });
  });

  it('hard-bounds subscribers that reuse one hung shared asset operation', async () => {
    let resolverSignal: AbortSignal | undefined;
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 1,
      maxPendingOperations: 2,
      resolveAssetBytes: (_assetId, signal) => {
        resolverSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError(signal)), { once: true });
        });
      },
    });
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const admitted = controllers.map(controller =>
      provider.pcmRange('shared-hung', 0, 0, 1, controller.signal),
    );
    await waitFor(() => provider.snapshot().sharedOperationSubscribers === 3);
    expect(provider.snapshot()).toMatchObject({
      activeOperations: 1,
      pendingOperations: 0,
      inFlightRequests: 3,
      maxInFlightRequests: 3,
      sharedOperationSubscribers: 3,
    });
    const rejected = provider.pcmRange('shared-hung', 0, 0, 1);
    await expect(rejected).rejects.toMatchObject({
      name: 'AelionError',
      diagnostics: [{ code: 'MEDIA_PROVIDER_QUEUE_FULL' }],
    });
    expect(resolverSignal?.aborted).toBe(false);
    controllers.forEach(controller => controller.abort());
    await Promise.allSettled(admitted);
    await waitFor(() => provider.snapshot().inFlightAssetLoads === 0);
    expect(resolverSignal?.aborted).toBe(true);
    expect(provider.snapshot()).toMatchObject({
      activeOperations: 0,
      pendingOperations: 0,
      inFlightRequests: 0,
      sharedOperationSubscribers: 0,
    });
  });

  it('removes cancelled subscribers while a long-lived shared caller survives', async () => {
    const gate = deferred<Uint8Array>();
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 1,
      maxPendingOperations: 1,
      resolveAssetBytes: () => gate.promise,
    });
    const survivor = provider.pcmRange('shared-survivor', 0, 0, 1);
    await waitFor(() => provider.snapshot().sharedOperationSubscribers === 1);

    for (let index = 0; index < 100; index += 1) {
      const controller = new AbortController();
      const cancelled = provider.pcmRange('shared-survivor', 0, 0, 1, controller.signal);
      await waitFor(() => provider.snapshot().sharedOperationSubscribers === 2);
      controller.abort(new DOMException('short-lived subscriber', 'AbortError'));
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      expect(provider.snapshot()).toMatchObject({
        inFlightRequests: 1,
        sharedOperationSubscribers: 1,
      });
    }

    gate.resolve(new Uint8Array([1, 2, 3, 4]));
    await settleAudio(survivor);
    expect(provider.snapshot()).toMatchObject({
      inFlightRequests: 0,
      sharedOperationSubscribers: 0,
      inFlightAssetLoads: 0,
    });
  });

  it('keeps non-cooperative cancelled loads bounded and fails closed', async () => {
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 2,
      maxPendingOperations: 2,
      // Deliberately ignore the internal signal. The provider cannot kill an
      // arbitrary Promise, but it must retain no more than its hard budgets.
      resolveAssetBytes: () => new Promise(() => undefined),
    });
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const requests = controllers.map((controller, index) =>
      provider.pcmRange(`hung-${index.toString()}`, 0, 0, 1, controller.signal),
    );
    await waitFor(
      () =>
        provider.snapshot().activeOperations === 2 && provider.snapshot().pendingOperations === 2,
    );
    controllers.forEach(controller => controller.abort());
    const results = await Promise.allSettled(requests);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    await waitFor(
      () =>
        provider.snapshot().inFlightAssetLoads === 2 && provider.snapshot().pendingOperations === 0,
    );
    expect(provider.snapshot()).toMatchObject({
      inFlightRequests: 0,
      sharedOperationSubscribers: 0,
      activeOperations: 2,
      pendingOperations: 0,
      inFlightAssetLoads: 2,
      maxConcurrentOperations: 2,
      maxPendingOperations: 2,
      maxInFlightRequests: 4,
    });

    const queuedControllers = [new AbortController(), new AbortController()];
    const queued = queuedControllers.map((controller, index) =>
      provider.pcmRange(`queued-${index.toString()}`, 0, 0, 1, controller.signal),
    );
    await waitFor(() => provider.snapshot().pendingOperations === 2);
    for (let index = 0; index < 100; index += 1) {
      await expect(provider.pcmRange(`extra-${index.toString()}`, 0, 0, 1)).rejects.toMatchObject({
        diagnostics: [{ code: 'MEDIA_PROVIDER_QUEUE_FULL' }],
      });
    }
    queuedControllers.forEach(controller => controller.abort());
    await Promise.allSettled(queued);
    await waitFor(
      () =>
        provider.snapshot().inFlightAssetLoads === 2 && provider.snapshot().pendingOperations === 0,
    );
    expect(provider.snapshot()).toMatchObject({
      inFlightRequests: 0,
      sharedOperationSubscribers: 0,
      activeOperations: 2,
      pendingOperations: 0,
      inFlightAssetLoads: 2,
    });
  });

  it('fails closed when the bounded pending queue is full', async () => {
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 1,
      maxPendingOperations: 1,
      resolveAssetBytes: (_assetId, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError(signal)), { once: true });
        }),
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = provider.pcmRange('first', 0, 0, 1, firstController.signal);
    await waitFor(() => provider.snapshot().activeOperations === 1);
    const second = provider.pcmRange('second', 0, 0, 1, secondController.signal);
    await waitFor(() => provider.snapshot().pendingOperations === 1);
    const rejected = provider.pcmRange('third', 0, 0, 1);
    await expect(rejected).rejects.toBeInstanceOf(AelionError);
    await expect(rejected).rejects.toMatchObject({
      diagnostics: [{ code: 'MEDIA_PROVIDER_QUEUE_FULL' }],
    });
    firstController.abort();
    secondController.abort();
    await Promise.allSettled([first, second]);
    await waitFor(() => provider.snapshot().activeOperations === 0);
  });

  it('does not let a pre-clear load repopulate the cache', async () => {
    const gates: Deferred<Uint8Array>[] = [];
    const provider = new ByteMediaProvider({
      resolveAssetBytes: () => {
        const gate = deferred<Uint8Array>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const oldRequest = provider.pcmRange('asset', 0, 0, 1);
    await waitFor(() => gates.length === 1);
    provider.clear();
    const newRequest = provider.pcmRange('asset', 0, 0, 1);
    await waitFor(() => gates.length === 2);
    gates[0]?.resolve(new Uint8Array([1, 2, 3]));
    await settleAudio(oldRequest);
    expect(provider.snapshot().assets).toBe(0);
    gates[1]?.resolve(new Uint8Array([4, 5, 6, 7]));
    await settleAudio(newRequest);
    expect(provider.snapshot()).toMatchObject({ assets: 1, cachedBytes: 4 });
  });

  it('single-flights SampleIndex and aborts it after the last subscriber cancels', async () => {
    const provider = new ByteMediaProvider({
      resolveAssetBytes: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = provider.frameAt('video', 0, 0, firstController.signal);
    await waitFor(() => media.indexGates.length === 1);
    const second = provider.frameAt('video', 0, 0, secondController.signal);
    await waitFor(() => provider.snapshot().inFlightSampleIndexes === 1);
    expect(media.createIndexCalls).toBe(1);
    firstController.abort(new DOMException('first index caller cancelled', 'AbortError'));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(media.indexGates[0]?.signal?.aborted).toBe(false);
    secondController.abort(new DOMException('last index caller cancelled', 'AbortError'));
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => provider.snapshot().inFlightSampleIndexes === 0);
    expect(media.indexGates[0]?.signal?.aborted).toBe(true);
    expect(provider.snapshot()).toMatchObject({
      inFlightSampleIndexes: 0,
      activeOperations: 0,
      pendingOperations: 0,
    });
  });

  it('keeps a shared SampleIndex alive while another subscriber survives', async () => {
    const provider = new ByteMediaProvider({
      resolveAssetBytes: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
    });
    const controller = new AbortController();
    const cancelled = provider.frameAt('video', 0, 0, controller.signal);
    await waitFor(() => media.indexGates.length === 1);
    const survivor = provider.frameAt('video', 0, 0);
    await waitFor(() => provider.snapshot().inFlightSampleIndexes === 1);
    await Promise.resolve();
    controller.abort(new DOMException('one index caller cancelled', 'AbortError'));
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(media.indexGates[0]?.signal?.aborted).toBe(false);
    media.indexGates[0]?.resolve();
    await waitFor(() => media.decodeVideoReleases.length === 1);
    releaseAll(media.decodeVideoReleases);
    await expect(survivor).resolves.toBeDefined();
    expect(provider.snapshot()).toMatchObject({
      inFlightSampleIndexes: 0,
      activeOperations: 0,
      pendingOperations: 0,
    });
  });

  it('hard-bounds index and video decode operations with the shared budget', async () => {
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 2,
      maxPendingOperations: 8,
      resolveAssetBytes: assetId => Promise.resolve(new Uint8Array([assetId.length + 1, 2, 3, 4])),
    });
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const requests = controllers.map((controller, index) =>
      provider.frameAt(`video-${index.toString()}`, 0, index, controller.signal),
    );
    await waitFor(
      () => media.indexGates.length === 2 && provider.snapshot().pendingOperations === 2,
    );
    expect(provider.snapshot().activeOperations).toBe(2);
    media.indexGates.shift()?.resolve();
    media.indexGates.shift()?.resolve();
    await waitFor(() => media.indexGates.length === 2);
    media.indexGates.shift()?.resolve();
    media.indexGates.shift()?.resolve();
    await waitFor(() => media.decodeVideoCalls === 2);
    expect(media.decodeVideoMaxActive).toBe(2);
    releaseAll(media.decodeVideoReleases);
    await waitFor(() => media.decodeVideoCalls === 4);
    releaseAll(media.decodeVideoReleases);
    const results = await Promise.allSettled(requests);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(media.decodeVideoMaxActive).toBe(2);
    expect(provider.snapshot()).toMatchObject({ activeOperations: 0, pendingOperations: 0 });
  });

  it('hard-bounds PCM decode operations and removes cancelled queued decodes', async () => {
    const provider = new ByteMediaProvider({
      maxConcurrentOperations: 2,
      maxPendingOperations: 8,
      resolveAssetBytes: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
    });
    // Warm bytes so this assertion measures only decode admission.
    await settleAudio(provider.pcmRange('audio', 0, 0, 1));
    resetMediaMocks();

    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const requests = controllers.map(controller =>
      provider.pcmRange('audio', 0, 0, 1, controller.signal),
    );
    await waitFor(
      () => media.decodeAudioCalls === 2 && provider.snapshot().pendingOperations === 4,
    );
    expect(media.decodeAudioMaxActive).toBe(2);
    controllers.slice(2).forEach(controller => controller.abort());
    await waitFor(() => provider.snapshot().pendingOperations === 0);
    releaseAll(media.decodeAudioReleases);
    const results = await Promise.allSettled(requests);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(media.decodeAudioCalls).toBe(2);
    expect(provider.snapshot()).toMatchObject({ activeOperations: 0, pendingOperations: 0 });
  });

  it.each(['resolver-sync', 'resolver-async', 'index', 'audio-decode'] as const)(
    'drains every resource counter after a %s failure',
    async failure => {
      const provider = new ByteMediaProvider({
        maxConcurrentOperations: 1,
        maxPendingOperations: 1,
        resolveAssetBytes: () => {
          if (failure === 'resolver-sync') throw new Error('synthetic resolver failure');
          if (failure === 'resolver-async') {
            return Promise.reject(new Error('synthetic resolver failure'));
          }
          return Promise.resolve(new Uint8Array([1, 2, 3, 4]));
        },
      });

      let request: Promise<unknown>;
      if (failure === 'index') {
        request = provider.frameAt('failing', 0, 0);
        await waitFor(() => media.indexGates.length === 1);
        media.indexGates[0]?.reject(new Error('synthetic index failure'));
      } else if (failure === 'audio-decode') {
        const controller = new AbortController();
        request = provider.pcmRange('failing', 0, 0, 1, controller.signal);
        await waitFor(() => media.decodeAudioReleases.length === 1);
        controller.abort(new DOMException('synthetic decode failure', 'AbortError'));
      } else {
        request = provider.pcmRange('failing', 0, 0, 1);
      }

      await expect(request).rejects.toBeInstanceOf(Error);
      await waitFor(
        () =>
          provider.snapshot().activeOperations === 0 &&
          provider.snapshot().inFlightRequests === 0 &&
          provider.snapshot().inFlightAssetLoads === 0 &&
          provider.snapshot().inFlightSampleIndexes === 0,
      );
      expect(provider.snapshot()).toMatchObject({
        activeOperations: 0,
        pendingOperations: 0,
        inFlightRequests: 0,
        inFlightAssetLoads: 0,
        inFlightSampleIndexes: 0,
        sharedOperationSubscribers: 0,
      });
    },
  );

  it('validates operation limits and its backwards-compatible alias', () => {
    expect(
      () =>
        new ByteMediaProvider({
          maxConcurrentOperations: 0,
          resolveAssetBytes: () => Promise.resolve(new Uint8Array([1])),
        }),
    ).toThrow('maxConcurrentOperations');
    expect(
      () =>
        new ByteMediaProvider({
          maxConcurrentOperations: 2,
          maxConcurrentLoads: 3,
          resolveAssetBytes: () => Promise.resolve(new Uint8Array([1])),
        }),
    ).toThrow('must match');
    const failFast = new ByteMediaProvider({
      maxConcurrentOperations: 2,
      maxPendingOperations: 0,
      resolveAssetBytes: () => Promise.resolve(new Uint8Array([1])),
    });
    expect(failFast.snapshot()).toMatchObject({
      maxConcurrentOperations: 2,
      maxPendingOperations: 0,
      maxInFlightRequests: 2,
    });
    const provider = new ByteMediaProvider({
      maxConcurrentLoads: 3,
      resolveAssetBytes: () => Promise.resolve(new Uint8Array([1])),
    });
    expect(provider.snapshot()).toMatchObject({
      maxConcurrentOperations: 3,
      maxConcurrentLoads: 3,
    });
  });
});
