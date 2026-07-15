import { AelionError, throwIfAborted } from '@aelion/core';

import type { ByteRange, RangeRead, RangeReader } from './types.js';

function assertRange(range: ByteRange): void {
  if (
    !Number.isSafeInteger(range.offset) ||
    !Number.isSafeInteger(range.length) ||
    range.offset < 0 ||
    range.length <= 0
  ) {
    throw new RangeError('Byte range offset must be non-negative and length must be positive');
  }
  if (!Number.isSafeInteger(range.offset + range.length)) {
    throw new RangeError('Byte range end exceeds the safe integer range');
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('RangeReader failed', { cause: value });
}

function mediaNetworkError(code: string, message: string, cause?: unknown): AelionError {
  return new AelionError([
    {
      code,
      severity: 'error',
      message,
      recoverable: true,
      ...(cause === undefined ? {} : { cause }),
    },
  ]);
}

export class MemoryRangeReader implements RangeReader {
  public readonly kind = 'memory' as const;
  readonly #bytes: Uint8Array;

  public constructor(
    public readonly id: string,
    bytes: Uint8Array,
  ) {
    this.#bytes = bytes.slice();
  }

  public size(signal?: AbortSignal): Promise<number> {
    try {
      throwIfAborted(signal, 'memory source size');
      return Promise.resolve(this.#bytes.byteLength);
    } catch (error) {
      return Promise.reject(asError(error));
    }
  }

  public read(range: ByteRange, signal?: AbortSignal): Promise<RangeRead> {
    try {
      throwIfAborted(signal, 'memory range read');
      assertRange(range);
      if (range.offset + range.length > this.#bytes.byteLength) {
        throw new RangeError('Byte range exceeds source size');
      }
      return Promise.resolve({
        bytes: this.#bytes.slice(range.offset, range.offset + range.length),
        range,
        totalSize: this.#bytes.byteLength,
        source: 'memory',
      });
    } catch (error) {
      return Promise.reject(asError(error));
    }
  }
}

export class BlobRangeReader implements RangeReader {
  public readonly kind = 'blob' as const;
  readonly #blob: Blob;

  public constructor(
    public readonly id: string,
    blob: Blob,
  ) {
    this.#blob = blob;
  }

  public size(signal?: AbortSignal): Promise<number> {
    try {
      throwIfAborted(signal, 'blob source size');
      return Promise.resolve(this.#blob.size);
    } catch (error) {
      return Promise.reject(asError(error));
    }
  }

  public async read(range: ByteRange, signal?: AbortSignal): Promise<RangeRead> {
    throwIfAborted(signal, 'blob range read');
    assertRange(range);
    if (range.offset + range.length > this.#blob.size) {
      throw new RangeError('Byte range exceeds source size');
    }
    const buffer = await this.#blob.slice(range.offset, range.offset + range.length).arrayBuffer();
    throwIfAborted(signal, 'blob range read');
    return {
      bytes: new Uint8Array(buffer),
      range,
      totalSize: this.#blob.size,
      source: 'blob',
    };
  }
}

export interface FetchRangeReaderOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

export class FetchRangeReader implements RangeReader {
  public readonly kind = 'network' as const;
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Readonly<Record<string, string>>;
  #size?: number;

  public constructor(
    public readonly id: string,
    public readonly url: string,
    options: FetchRangeReaderOptions = {},
  ) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = options.headers ?? {};
  }

  public async size(signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal, 'network source size');
    if (this.#size !== undefined) return this.#size;

    let response: Response;
    try {
      response = await this.#fetch(this.url, {
        method: 'HEAD',
        headers: this.#headers,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (cause) {
      throw mediaNetworkError(
        'MEDIA_NETWORK_OR_CORS_FAILED',
        'Media HEAD request failed because of network or CORS policy',
        cause,
      );
    }
    if (!response.ok) {
      throw new Error(`HEAD request failed with HTTP ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength === null) return this.#probeSize(signal);
    const size = Number(contentLength);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error('Content-Length is missing or outside the safe integer range');
    }
    this.#size = size;
    return size;
  }

  public async read(range: ByteRange, signal?: AbortSignal): Promise<RangeRead> {
    throwIfAborted(signal, 'network range read');
    assertRange(range);
    const end = range.offset + range.length - 1;
    let response: Response;
    try {
      response = await this.#fetch(this.url, {
        headers: { ...this.#headers, Range: `bytes=${range.offset}-${end}` },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (cause) {
      throw mediaNetworkError(
        'MEDIA_NETWORK_OR_CORS_FAILED',
        'Media Range request failed because of network or CORS policy',
        cause,
      );
    }
    if (response.status !== 206) {
      throw mediaNetworkError(
        response.status === 200 ? 'MEDIA_RANGE_UNSUPPORTED' : 'MEDIA_RANGE_REQUEST_FAILED',
        response.status === 200
          ? 'Server ignored Range and returned the full resource'
          : `Range request failed with HTTP ${response.status}`,
      );
    }
    const contentRange = response.headers.get('content-range');
    const parsed = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/u);
    if (parsed === undefined || parsed === null) {
      throw new Error('Range response is missing a valid Content-Range header');
    }
    const actualStart = Number(parsed[1]);
    const actualEnd = Number(parsed[2]);
    const totalSize = Number(parsed[3]);
    if (
      actualStart !== range.offset ||
      actualEnd !== end ||
      !Number.isSafeInteger(totalSize) ||
      totalSize <= end
    ) {
      throw new Error('Range response does not match the requested byte interval');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== range.length) {
      throw new Error('Range response body length does not match Content-Range');
    }
    this.#size = totalSize;
    return { bytes, range, totalSize, source: 'network' };
  }

  async #probeSize(signal?: AbortSignal): Promise<number> {
    let response: Response;
    try {
      response = await this.#fetch(this.url, {
        headers: { ...this.#headers, Range: 'bytes=0-0' },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (cause) {
      throw mediaNetworkError(
        'MEDIA_NETWORK_OR_CORS_FAILED',
        'Media Range size probe failed because of network or CORS policy',
        cause,
      );
    }
    if (response.status !== 206) {
      throw mediaNetworkError(
        'MEDIA_RANGE_UNSUPPORTED',
        'Source size is unavailable and the server does not support byte ranges',
      );
    }
    const contentRange = response.headers.get('content-range');
    const parsed = contentRange?.match(/^bytes 0-0\/(\d+)$/u);
    const size = parsed === undefined || parsed === null ? Number.NaN : Number(parsed[1]);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error('Range size probe returned an invalid Content-Range');
    }
    this.#size = size;
    return size;
  }
}
