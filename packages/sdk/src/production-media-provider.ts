import type { PcmSourceBlock } from '@aelion/audio';
import { throwIfAborted, type JsonObject } from '@aelion/core';
import {
  BlobRangeReader,
  FetchRangeReader,
  MemoryCacheStore,
  PageMediaResourceGovernor,
  createSampleIndexFromReader,
  decodeAudioPcmRangeFromReader,
  decodeVideoFrameAtFromReader,
  proxyPresentationTimeUs,
  selectAssetRepresentation,
  type CacheAddress,
  type CacheStore,
  type FetchRangeReaderOptions,
  type MediaResourceGovernorSnapshot,
  type RangeReader,
  type SampleIndex,
} from '@aelion/media';

import type { AelionMediaProvider, AelionMediaRequest } from './types.js';

const SAMPLE_INDEX_CACHE_VERSION = 'aelion-sample-index-v1';

export type ProductionMediaRole = 'original' | 'proxy' | 'thumbnail' | 'waveform';

export interface ProductionMediaRepresentationOptions {
  /** Stable representation id. Defaults to `${assetId}:${role}`. */
  readonly id?: string;
  readonly role?: ProductionMediaRole;
  readonly durationUs?: number;
  readonly width?: number;
  readonly height?: number;
  /** Optional lowercase SHA-256. Enables content-addressed persistent SampleIndex reuse. */
  readonly contentHash?: string;
  readonly sourceStartUs?: number;
}

export interface ProductionMediaUrlOptions
  extends ProductionMediaRepresentationOptions,
    FetchRangeReaderOptions {}

export interface ProductionMediaProviderOptions {
  /** Persistent or tiered cache. A bounded memory cache is used by default. */
  readonly cache?: CacheStore;
  /** Shared page-level budget. A provider-owned governor is created by default. */
  readonly governor?: PageMediaResourceGovernor;
  readonly maxCachedIndexes?: number;
  readonly maxCachedIndexBytes?: number;
  readonly maxConcurrentOperations?: number;
  readonly maxPendingOperations?: number;
}

export interface ProductionMediaSelection {
  readonly assetId: string;
  readonly representationId: string;
  readonly role: ProductionMediaRole;
  readonly usedProxy: boolean;
  readonly diagnostics: readonly string[];
}

export interface ProductionMediaProbe extends ProductionMediaSelection {
  readonly index: SampleIndex;
}

export interface ProductionMediaProviderSnapshot {
  readonly assets: number;
  readonly representations: number;
  readonly cachedIndexes: number;
  readonly cachedIndexBytes: number;
  readonly maxCachedIndexes: number;
  readonly maxCachedIndexBytes: number;
  readonly activeOperations: number;
  readonly pendingOperations: number;
  readonly maxConcurrentOperations: number;
  readonly maxPendingOperations: number;
  readonly governor: MediaResourceGovernorSnapshot;
  readonly cache: ReturnType<CacheStore['snapshot']>;
  readonly disposed: boolean;
}

interface RegisteredRepresentation {
  readonly id: string;
  readonly role: ProductionMediaRole;
  readonly reader: RangeReader;
  readonly contentHash?: string;
  durationUs?: number;
  width?: number;
  height?: number;
  readonly sourceStartUs?: number;
}

interface RegisteredAsset {
  readonly representations: Map<string, RegisteredRepresentation>;
}

interface ResidentIndex {
  readonly index: SampleIndex;
  readonly byteLength: number;
  access: number;
}

interface OperationWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function assertIdentifier(value: string, name: string): void {
  if (value.trim().length === 0 || value.length > 512) {
    throw new TypeError(`${name} must be a non-empty string of at most 512 characters`);
  }
}

function assertOptionalDimension(value: number | undefined, name: string): void {
  if (value !== undefined) positiveSafeInteger(value, name);
}

function assertOptionalTime(value: number | undefined, name: string, allowZero: boolean): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(
      `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`,
    );
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Operation aborted', 'AbortError');
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback, { cause: value });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializeSampleIndex(index: SampleIndex): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(index, (_key, value: unknown) =>
      value instanceof Uint8Array ? { __aelionBytes: [...value] } : value,
    ),
  );
}

function reviveBytes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(entry => reviveBytes(entry));
  if (!isRecord(value)) return value;
  if (
    Array.isArray(value.__aelionBytes) &&
    value.__aelionBytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return Uint8Array.from(value.__aelionBytes as number[]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, reviveBytes(entry)]));
}

function deserializeSampleIndex(bytes: Uint8Array): SampleIndex | undefined {
  let value: unknown;
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    value = reviveBytes(parsed);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== '1.0.0' ||
    typeof value.durationUs !== 'number' ||
    !Array.isArray(value.tracks) ||
    !isRecord(value.samples) ||
    !isRecord(value.presentationOrder) ||
    !Array.isArray(value.diagnostics)
  ) {
    return undefined;
  }
  return value as unknown as SampleIndex;
}

function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(asError(error, 'Media operation failed'));
      },
    );
  });
}

/**
 * Range-backed media provider for File/Blob, URL and OPFS sources.
 *
 * It keeps whole media out of JavaScript memory, reuses content-addressed
 * SampleIndexes, chooses preview proxies, and bounds decoder work across a page.
 */
export class ProductionMediaProvider implements AelionMediaProvider {
  readonly #assets = new Map<string, RegisteredAsset>();
  readonly #residentIndexes = new Map<string, ResidentIndex>();
  readonly #indexOperations = new Map<string, Promise<SampleIndex>>();
  readonly #cache: CacheStore;
  readonly #governor: PageMediaResourceGovernor;
  readonly #ownsGovernor: boolean;
  readonly #maxCachedIndexes: number;
  readonly #maxCachedIndexBytes: number;
  readonly #maxConcurrentOperations: number;
  readonly #maxPendingOperations: number;
  readonly #waiters: OperationWaiter[] = [];
  readonly #lifecycle = new AbortController();
  #cachedIndexBytes = 0;
  #clock = 0;
  #activeOperations = 0;
  #operationSequence = 0;
  #generation = 0;
  #disposed = false;

  public constructor(options: ProductionMediaProviderOptions = {}) {
    this.#maxCachedIndexes = positiveSafeInteger(options.maxCachedIndexes ?? 8, 'maxCachedIndexes');
    this.#maxCachedIndexBytes = positiveSafeInteger(
      options.maxCachedIndexBytes ?? 64 * 1_024 * 1_024,
      'maxCachedIndexBytes',
    );
    this.#maxConcurrentOperations = positiveSafeInteger(
      options.maxConcurrentOperations ?? 4,
      'maxConcurrentOperations',
    );
    this.#maxPendingOperations = nonNegativeSafeInteger(
      options.maxPendingOperations ?? 64,
      'maxPendingOperations',
    );
    this.#cache = options.cache ?? new MemoryCacheStore(this.#maxCachedIndexBytes);
    this.#ownsGovernor = options.governor === undefined;
    this.#governor =
      options.governor ??
      new PageMediaResourceGovernor(
        {
          decoderSlots: this.#maxConcurrentOperations,
          gpuBytes: 1,
          cacheBytes: this.#maxCachedIndexBytes,
        },
        Math.max(1, this.#maxPendingOperations),
      );
  }

  public registerReader(
    assetId: string,
    reader: RangeReader,
    options: ProductionMediaRepresentationOptions = {},
  ): void {
    this.#assertActive();
    assertIdentifier(assetId, 'assetId');
    assertIdentifier(reader.id, 'RangeReader id');
    const role = options.role ?? 'original';
    const id = options.id ?? `${assetId}:${role}`;
    assertIdentifier(id, 'representation id');
    assertOptionalTime(options.durationUs, 'durationUs', false);
    assertOptionalTime(options.sourceStartUs, 'sourceStartUs', true);
    assertOptionalDimension(options.width, 'width');
    assertOptionalDimension(options.height, 'height');
    if (options.contentHash !== undefined && !/^[0-9a-f]{64}$/u.test(options.contentHash)) {
      throw new TypeError('contentHash must be a lowercase SHA-256 value');
    }

    let asset = this.#assets.get(assetId);
    if (asset === undefined) {
      asset = { representations: new Map() };
      this.#assets.set(assetId, asset);
    }
    if (role === 'original') {
      for (const [existingId, existing] of asset.representations) {
        if (existing.role === 'original' && existingId !== id) {
          asset.representations.delete(existingId);
          this.#dropResidentIndex(this.#indexKey(assetId, existingId));
        }
      }
    }
    asset.representations.set(id, {
      id,
      role,
      reader,
      ...(options.durationUs === undefined ? {} : { durationUs: options.durationUs }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
      ...(options.contentHash === undefined ? {} : { contentHash: options.contentHash }),
      ...(options.sourceStartUs === undefined ? {} : { sourceStartUs: options.sourceStartUs }),
    });
    this.#generation += 1;
    this.#dropResidentIndex(this.#indexKey(assetId, id));
  }

  public registerBlob(
    assetId: string,
    blob: Blob,
    options: ProductionMediaRepresentationOptions = {},
  ): void {
    const role = options.role ?? 'original';
    const id = options.id ?? `${assetId}:${role}`;
    this.registerReader(assetId, new BlobRangeReader(id, blob), { ...options, id, role });
  }

  public registerFile(
    assetId: string,
    file: File,
    options: ProductionMediaRepresentationOptions = {},
  ): void {
    this.registerBlob(assetId, file, options);
  }

  public registerUrl(assetId: string, url: string, options: ProductionMediaUrlOptions = {}): void {
    const role = options.role ?? 'original';
    const id = options.id ?? `${assetId}:${role}`;
    const readerOptions: FetchRangeReaderOptions = {
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    };
    this.registerReader(assetId, new FetchRangeReader(id, url, readerOptions), {
      ...options,
      id,
      role,
    });
  }

  public async registerOpfs(
    assetId: string,
    path: string,
    options: ProductionMediaRepresentationOptions = {},
  ): Promise<void> {
    this.#assertActive();
    const navigatorValue: unknown = Reflect.get(globalThis, 'navigator');
    const storage = isRecord(navigatorValue) ? navigatorValue.storage : undefined;
    const getDirectory = isRecord(storage) ? storage.getDirectory : undefined;
    if (typeof getDirectory !== 'function') {
      throw new Error('Origin Private File System is unavailable');
    }
    const parts = path.split('/');
    if (
      parts.length === 0 ||
      parts.some(part => part.length === 0 || part === '.' || part === '..')
    ) {
      throw new TypeError('OPFS path must be a relative file path without empty or dot segments');
    }
    const fileName = parts.pop();
    if (fileName === undefined) throw new TypeError('OPFS path must name a file');
    let directory = await (Reflect.apply(
      getDirectory,
      storage,
      [],
    ) as Promise<FileSystemDirectoryHandle>);
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();
    this.registerFile(assetId, file, options);
  }

  public unregister(assetId: string): boolean {
    this.#assertActive();
    const removed = this.#assets.delete(assetId);
    if (!removed) return false;
    this.#generation += 1;
    for (const key of [...this.#residentIndexes.keys()]) {
      if (key.startsWith(`${assetId}\u0000`)) this.#dropResidentIndex(key);
    }
    return true;
  }

  public representationFor(
    assetId: string,
    request: Partial<AelionMediaRequest> & { readonly purpose?: 'preview' | 'export' } = {},
  ): ProductionMediaSelection {
    const selected = this.#select(assetId, request);
    return {
      assetId,
      representationId: selected.representation.id,
      role: selected.representation.role,
      usedProxy: selected.usedProxy,
      diagnostics: selected.diagnostics,
    };
  }

  public async probe(
    assetId: string,
    options: Partial<AelionMediaRequest> & { readonly signal?: AbortSignal } = {},
  ): Promise<ProductionMediaProbe> {
    const selected = this.#select(assetId, options);
    const index = await this.#sampleIndex(assetId, selected.representation, options.signal);
    return {
      assetId,
      representationId: selected.representation.id,
      role: selected.representation.role,
      usedProxy: selected.usedProxy,
      diagnostics: selected.diagnostics,
      index,
    };
  }

  public async frameAt(
    assetId: string,
    streamIndex: number,
    sourceTimeUs: number,
    signal?: AbortSignal,
    request?: AelionMediaRequest,
  ): Promise<VideoFrame> {
    this.#assertActive();
    const selected = this.#select(assetId, request ?? { purpose: 'export' });
    const index = await this.#sampleIndex(assetId, selected.representation, signal);
    const presentationTimeUs = proxyPresentationTimeUs(sourceTimeUs, {
      id: selected.representation.id,
      role: selected.representation.role,
      locator: selected.representation.reader.id,
      ...(selected.representation.durationUs === undefined
        ? {}
        : { durationUs: selected.representation.durationUs }),
      ...(selected.representation.sourceStartUs === undefined
        ? {}
        : { sourceStartUs: selected.representation.sourceStartUs }),
    });
    return this.#run(signal, async operationSignal => {
      const lease = await this.#governor.acquire(
        {
          ownerId: `aelion-media:${++this.#operationSequence}:${assetId}`,
          priority: request?.purpose === 'preview' ? 'preview' : 'export',
          decoderSlots: 1,
          gpuBytes: 0,
          cacheBytes: 0,
        },
        operationSignal,
      );
      try {
        const result = await decodeVideoFrameAtFromReader(
          selected.representation.reader,
          presentationTimeUs,
          {
            sampleIndex: index,
            streamIndex,
            signal: operationSignal,
            maxDecodeQueueSize: 8,
          },
        );
        try {
          throwIfAborted(operationSignal, 'production media video decode');
          return result.frame.clone();
        } finally {
          result.close();
        }
      } finally {
        await lease.dispose();
      }
    });
  }

  public async pcmRange(
    assetId: string,
    streamIndex: number,
    startUs: number,
    durationUs: number,
    signal?: AbortSignal,
  ): Promise<PcmSourceBlock> {
    this.#assertActive();
    const selected = this.#select(assetId, { purpose: 'export' });
    return this.#run(signal, async operationSignal => {
      const lease = await this.#governor.acquire(
        {
          ownerId: `aelion-media:${++this.#operationSequence}:${assetId}:audio`,
          priority: 'preview',
          decoderSlots: 1,
          gpuBytes: 0,
          cacheBytes: 0,
        },
        operationSignal,
      );
      try {
        return await decodeAudioPcmRangeFromReader(
          selected.representation.reader,
          startUs,
          durationUs,
          { streamIndex, signal: operationSignal },
        );
      } finally {
        await lease.dispose();
      }
    });
  }

  public clear(): void {
    this.#assertActive();
    this.#generation += 1;
    this.#residentIndexes.clear();
    this.#cachedIndexBytes = 0;
  }

  public snapshot(): ProductionMediaProviderSnapshot {
    return {
      assets: this.#assets.size,
      representations: [...this.#assets.values()].reduce(
        (total, asset) => total + asset.representations.size,
        0,
      ),
      cachedIndexes: this.#residentIndexes.size,
      cachedIndexBytes: this.#cachedIndexBytes,
      maxCachedIndexes: this.#maxCachedIndexes,
      maxCachedIndexBytes: this.#maxCachedIndexBytes,
      activeOperations: this.#activeOperations,
      pendingOperations: this.#waiters.length,
      maxConcurrentOperations: this.#maxConcurrentOperations,
      maxPendingOperations: this.#maxPendingOperations,
      governor: this.#governor.snapshot(),
      cache: this.#cache.snapshot(),
      disposed: this.#disposed,
    };
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycle.abort(new DOMException('ProductionMediaProvider was disposed', 'AbortError'));
    for (const waiter of this.#waiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new ReferenceError('ProductionMediaProvider is disposed'));
    }
    this.#assets.clear();
    this.#residentIndexes.clear();
    this.#cachedIndexBytes = 0;
    if (this.#ownsGovernor) this.#governor.dispose();
  }

  #select(
    assetId: string,
    request: Partial<AelionMediaRequest>,
  ): {
    readonly representation: RegisteredRepresentation;
    readonly usedProxy: boolean;
    readonly diagnostics: readonly string[];
  } {
    this.#assertActive();
    const asset = this.#assets.get(assetId);
    if (asset === undefined) throw new ReferenceError(`Unknown media asset: ${assetId}`);
    const original = [...asset.representations.values()].find(value => value.role === 'original');
    if (original === undefined) throw new ReferenceError(`Media asset has no original: ${assetId}`);
    const manifest = {
      id: assetId,
      locator: original.reader.id,
      representations: [...asset.representations.values()].map(value => ({
        id: value.id,
        role: value.role,
        locator: value.reader.id,
        ...(value.durationUs === undefined ? {} : { durationUs: value.durationUs }),
        ...(value.width === undefined ? {} : { width: value.width }),
        ...(value.height === undefined ? {} : { height: value.height }),
        ...(value.contentHash === undefined ? {} : { contentHash: value.contentHash }),
        ...(value.sourceStartUs === undefined ? {} : { sourceStartUs: value.sourceStartUs }),
      })),
    } satisfies JsonObject;
    const selection = selectAssetRepresentation(manifest, {
      purpose: request.purpose ?? 'export',
      ...(request.maxDimension === undefined ? {} : { maxDimension: request.maxDimension }),
      ...(original.durationUs === undefined ? {} : { sourceDurationUs: original.durationUs }),
    });
    const representation = asset.representations.get(selection.representation.id);
    if (representation === undefined) {
      throw new Error(
        `Selected media representation is not registered: ${selection.representation.id}`,
      );
    }
    return {
      representation,
      usedProxy: selection.usedProxy,
      diagnostics: selection.diagnostics,
    };
  }

  #sampleIndex(
    assetId: string,
    representation: RegisteredRepresentation,
    signal?: AbortSignal,
  ): Promise<SampleIndex> {
    throwIfAborted(signal, 'production media sample index');
    const key = this.#indexKey(assetId, representation.id);
    const resident = this.#residentIndexes.get(key);
    if (resident !== undefined) {
      resident.access = ++this.#clock;
      return Promise.resolve(resident.index);
    }
    const current = this.#indexOperations.get(key);
    if (current !== undefined) return awaitWithSignal(current, signal);

    const generation = this.#generation;
    const operation = this.#run(this.#lifecycle.signal, async operationSignal => {
      const address = this.#cacheAddress(representation);
      if (address !== undefined) {
        const cached = await this.#cache.get(address, operationSignal);
        if (cached !== undefined) {
          const restored = deserializeSampleIndex(cached);
          if (restored !== undefined) {
            this.#rememberIndex(key, restored, cached.byteLength, generation);
            this.#hydrateRepresentation(representation, restored, generation);
            return restored;
          }
          await this.#cache.delete(address, operationSignal);
        }
      }

      const index = await createSampleIndexFromReader(representation.reader, {
        signal: operationSignal,
      });
      const serialized = serializeSampleIndex(index);
      this.#hydrateRepresentation(representation, index, generation);
      this.#rememberIndex(key, index, serialized.byteLength, generation);
      if (address !== undefined && serialized.byteLength <= this.#maxCachedIndexBytes) {
        await this.#cache.put(address, serialized, operationSignal);
      }
      return index;
    });
    this.#indexOperations.set(key, operation);
    void operation.finally(() => this.#indexOperations.delete(key)).catch(() => undefined);
    return awaitWithSignal(operation, signal);
  }

  #hydrateRepresentation(
    representation: RegisteredRepresentation,
    index: SampleIndex,
    generation: number,
  ): void {
    if (generation !== this.#generation) return;
    representation.durationUs ??= index.durationUs;
    const video = index.tracks.find(track => track.kind === 'video');
    if (video !== undefined) {
      representation.width ??= video.codedWidth;
      representation.height ??= video.codedHeight;
    }
  }

  #rememberIndex(key: string, index: SampleIndex, byteLength: number, generation: number): void {
    if (generation !== this.#generation || byteLength > this.#maxCachedIndexBytes) return;
    this.#dropResidentIndex(key);
    this.#residentIndexes.set(key, { index, byteLength, access: ++this.#clock });
    this.#cachedIndexBytes += byteLength;
    while (
      this.#residentIndexes.size > this.#maxCachedIndexes ||
      this.#cachedIndexBytes > this.#maxCachedIndexBytes
    ) {
      const oldest = [...this.#residentIndexes.entries()].sort(
        (left, right) => left[1].access - right[1].access,
      )[0];
      if (oldest === undefined) break;
      this.#dropResidentIndex(oldest[0]);
    }
  }

  #dropResidentIndex(key: string): void {
    const resident = this.#residentIndexes.get(key);
    if (resident !== undefined) this.#cachedIndexBytes -= resident.byteLength;
    this.#residentIndexes.delete(key);
  }

  #cacheAddress(representation: RegisteredRepresentation): CacheAddress | undefined {
    return representation.contentHash === undefined
      ? undefined
      : {
          namespace: 'sample-index',
          contentHash: representation.contentHash,
          version: SAMPLE_INDEX_CACHE_VERSION,
          variant: representation.id,
        };
  }

  #indexKey(assetId: string, representationId: string): string {
    return `${assetId}\u0000${representationId}`;
  }

  async #run<T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.#assertActive();
    const release = await this.#acquireOperation(signal);
    const controller = new AbortController();
    const signals =
      signal === undefined ? [this.#lifecycle.signal] : [this.#lifecycle.signal, signal];
    const listeners = signals.map(source => {
      const abort = (): void => controller.abort(abortReason(source));
      source.addEventListener('abort', abort, { once: true });
      if (source.aborted) abort();
      return { source, abort };
    });
    try {
      throwIfAborted(controller.signal, 'production media operation');
      return await operation(controller.signal);
    } finally {
      for (const listener of listeners) {
        listener.source.removeEventListener('abort', listener.abort);
      }
      release();
    }
  }

  #acquireOperation(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) return Promise.reject(abortReason(signal));
    if (this.#activeOperations < this.#maxConcurrentOperations && this.#waiters.length === 0) {
      this.#activeOperations += 1;
      return Promise.resolve(this.#releaseOperation());
    }
    if (this.#waiters.length >= this.#maxPendingOperations) {
      return Promise.reject(new RangeError('MEDIA_RESOURCE_QUEUE_FULL'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index < 0) return;
        this.#waiters.splice(index, 1);
        reject(signal === undefined ? new Error('Operation aborted') : abortReason(signal));
      };
      const waiter: OperationWaiter = {
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
        onAbort,
      };
      this.#waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  #releaseOperation(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#activeOperations -= 1;
      const waiter = this.#waiters.shift();
      if (waiter === undefined) return;
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      this.#activeOperations += 1;
      waiter.resolve(this.#releaseOperation());
    };
  }

  #assertActive(): void {
    if (this.#disposed) throw new ReferenceError('ProductionMediaProvider is disposed');
  }
}
