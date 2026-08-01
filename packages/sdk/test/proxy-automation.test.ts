import type { RangeReader } from '@aelionsdk/media';
import { describe, expect, it } from 'vitest';

import { ProductionMediaProvider } from '../src/production-media-provider.js';
import { registerAutomaticProxy, type ProxyEncoder } from '../src/proxy-automation.js';

function originalReader(bytes: Uint8Array): RangeReader {
  return {
    id: 'mock:original',
    kind: 'memory',
    size: () => Promise.resolve(bytes.byteLength),
    read: ({ offset, length }) =>
      Promise.resolve({
        bytes: bytes.slice(offset, offset + length),
        range: { offset, length },
        totalSize: bytes.byteLength,
        source: 'memory' as const,
      }),
  };
}

const downscaled: ProxyEncoder = () =>
  Promise.resolve({
    bytes: new Uint8Array([9, 8, 7]),
    width: 320,
    height: 180,
    mimeType: 'image/webp',
  });

describe('registerAutomaticProxy', () => {
  it('registers a proxy and serves it for preview while keeping the original for export', async () => {
    const provider = new ProductionMediaProvider();
    provider.registerBlob('asset', new Blob([new Uint8Array([1])]), {
      id: 'asset:original',
      width: 3840,
      height: 2160,
      durationUs: 3_000_000,
    });
    const result = await registerAutomaticProxy(provider, {
      assetId: 'asset',
      originalReader: originalReader(new Uint8Array([1, 2, 3])),
      maxDimension: 1280,
      encode: downscaled,
    });
    expect(result).toEqual({
      representationId: 'asset:proxy',
      role: 'proxy',
      width: 320,
      height: 180,
      mimeType: 'image/webp',
      byteLength: 3,
    });
    expect(provider.representationFor('asset', { purpose: 'preview', maxDimension: 1280 })).toEqual(
      {
        assetId: 'asset',
        representationId: 'asset:proxy',
        role: 'proxy',
        usedProxy: true,
        diagnostics: [],
      },
    );
    expect(provider.representationFor('asset', { purpose: 'export' })).toEqual({
      assetId: 'asset',
      representationId: 'asset:original',
      role: 'original',
      usedProxy: false,
      diagnostics: [],
    });
  });

  it('fails closed for an unknown asset', async () => {
    const provider = new ProductionMediaProvider();
    await expect(
      registerAutomaticProxy(provider, {
        assetId: 'missing',
        originalReader: originalReader(new Uint8Array([1])),
        maxDimension: 1280,
        encode: downscaled,
      }),
    ).rejects.toThrow(/Unknown media asset/);
  });

  it('fails closed when the encoder produces empty bytes', async () => {
    const provider = new ProductionMediaProvider();
    provider.registerBlob('asset', new Blob([new Uint8Array([1])]), {
      id: 'asset:original',
    });
    const emptyEncoder: ProxyEncoder = () =>
      Promise.resolve({ bytes: new Uint8Array(0), width: 1, height: 1, mimeType: 'image/webp' });
    await expect(
      registerAutomaticProxy(provider, {
        assetId: 'asset',
        originalReader: originalReader(new Uint8Array([1])),
        maxDimension: 1280,
        encode: emptyEncoder,
      }),
    ).rejects.toThrow(/empty bytes/);
  });

  it('rejects a non-positive maxDimension', async () => {
    const provider = new ProductionMediaProvider();
    await expect(
      registerAutomaticProxy(provider, {
        assetId: 'asset',
        originalReader: originalReader(new Uint8Array([1])),
        maxDimension: 0,
        encode: downscaled,
      }),
    ).rejects.toThrow(/positive safe integer/);
  });
});
