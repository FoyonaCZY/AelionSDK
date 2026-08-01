import type { RangeReader } from '@aelionsdk/media';

import type { ProductionMediaProvider } from './production-media-provider.js';

export interface ProxyEncodeInput {
  /** Original bytes of the source representation to proxy. */
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
  readonly maxDimension: number;
  readonly signal?: AbortSignal;
}

export interface ProxyEncodeResult {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
}

/**
 * Contract for a proxy encoder. The SDK ships no encoder; a browser host
 * supplies one (e.g. decoding the first frame to an OffscreenCanvas and
 * encoding a downscaled WebP/JPEG) so the automatic-proxy flow stays
 * testable in Node. Encoding must honor `signal` and `maxDimension`.
 */
export type ProxyEncoder = (input: ProxyEncodeInput) => Promise<ProxyEncodeResult>;

export interface RegisterAutomaticProxyOptions {
  /** Original asset id to proxy. */
  readonly assetId: string;
  /** Range reader for the original bytes. */
  readonly originalReader: RangeReader;
  /** Largest proxy dimension (width or height) in pixels. */
  readonly maxDimension: number;
  /** Proxy encoder implementation (browser-supplied). */
  readonly encode: ProxyEncoder;
  readonly signal?: AbortSignal;
}

export interface AutomaticProxyResult {
  readonly representationId: string;
  readonly role: 'proxy';
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
  readonly byteLength: number;
}

/**
 * Generate and register a low-resolution proxy for an original asset through
 * an injected encoder, and return the registered representation. The provider
 * then serves the proxy for preview and keeps the original for export via
 * `selectAssetRepresentation`. Fails closed on an unknown asset or encoder
 * error without mutating the provider.
 */
export async function registerAutomaticProxy(
  provider: ProductionMediaProvider,
  options: RegisterAutomaticProxyOptions,
): Promise<AutomaticProxyResult> {
  if (!Number.isSafeInteger(options.maxDimension) || options.maxDimension <= 0) {
    throw new RangeError('maxDimension must be a positive safe integer');
  }
  // Fails closed with ReferenceError when the asset (or its original) is unknown.
  provider.representationFor(options.assetId, { purpose: 'export' });
  const size = await options.originalReader.size(options.signal);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('Original representation must have a positive byte size');
  }
  const read = await options.originalReader.read({ offset: 0, length: size }, options.signal);
  const encoded = await options.encode({
    bytes: read.bytes,
    maxDimension: options.maxDimension,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (encoded.bytes.byteLength === 0) {
    throw new TypeError('Proxy encoder produced empty bytes');
  }
  const blob = new Blob([encoded.bytes], { type: encoded.mimeType });
  const representationId = `${options.assetId}:proxy`;
  provider.registerBlob(options.assetId, blob, {
    id: representationId,
    role: 'proxy',
    width: encoded.width,
    height: encoded.height,
    mimeType: encoded.mimeType,
  });
  return {
    representationId,
    role: 'proxy',
    width: encoded.width,
    height: encoded.height,
    mimeType: encoded.mimeType,
    byteLength: encoded.bytes.byteLength,
  };
}
