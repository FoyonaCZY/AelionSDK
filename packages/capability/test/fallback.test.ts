import { describe, expect, it } from 'vitest';

import {
  CodecFallbackRegistry,
  selectCodecExecution,
  type CodecFallbackProvider,
  type CodecIdentity,
} from '../src/index.js';

const h264Decode: CodecIdentity = { class: 'video', operation: 'decode', codec: 'avc1.64001f' };
const aacDecode: CodecIdentity = { class: 'audio', operation: 'decode', codec: 'mp4a.40.2' };

function wasmProvider(id: string, supports: readonly CodecIdentity[]): CodecFallbackProvider {
  const key = (identity: CodecIdentity): string =>
    `${identity.class}:${identity.operation}:${identity.codec}`;
  const supported = new Set(supports.map(key));
  return {
    id,
    ready: true,
    supports: identity => supported.has(key(identity)),
  };
}

describe('selectCodecExecution', () => {
  it('uses hardware when the platform supports the codec', () => {
    const decision = selectCodecExecution(h264Decode, true, []);
    expect(decision.path).toBe('hardware');
    expect(decision.diagnostics).toEqual([]);
  });

  it('routes to the first ready provider that supports the identity', () => {
    const provider = wasmProvider('wasm-h264', [h264Decode]);
    const decision = selectCodecExecution(h264Decode, false, [provider]);
    expect(decision.path).toBe('fallback');
    if (decision.path === 'fallback') expect(decision.providerId).toBe('wasm-h264');
    expect(decision.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CAPABILITY_CODEC_FALLBACK_USED' })]),
    );
  });

  it('fails closed with a non-recoverable diagnostic when no backend exists', () => {
    const decision = selectCodecExecution(h264Decode, false, []);
    expect(decision.path).toBe('unavailable');
    expect(decision.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CAPABILITY_CODEC_NO_BACKEND' })]),
    );
  });

  it('ignores providers that do not support the identity', () => {
    const provider = wasmProvider('wasm-h264', [h264Decode]);
    const decision = selectCodecExecution(aacDecode, false, [provider]);
    expect(decision.path).toBe('unavailable');
  });

  it('ignores providers that are not ready', () => {
    const provider = { ...wasmProvider('wasm-h264', [h264Decode]), ready: false };
    const decision = selectCodecExecution(h264Decode, false, [provider]);
    expect(decision.path).toBe('unavailable');
  });
});

describe('CodecFallbackRegistry', () => {
  it('registers, lists and unregisters providers', () => {
    const registry = new CodecFallbackRegistry();
    const provider = wasmProvider('wasm-h264', [h264Decode]);
    registry.register(provider);
    expect(registry.providers()).toHaveLength(1);
    expect(registry.providers()[0]).toBe(provider);
    registry.unregister('wasm-h264');
    expect(registry.providers()).toHaveLength(0);
  });

  it('rejects duplicate provider ids', () => {
    const registry = new CodecFallbackRegistry();
    registry.register(wasmProvider('dup', []));
    expect(() => registry.register(wasmProvider('dup', []))).toThrow(/already registered/);
  });
});
