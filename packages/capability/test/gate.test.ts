import { describe, expect, it } from 'vitest';

import { evaluateCapabilityGate, type CapabilityReport } from '../src/index.js';

function report(
  overrides: {
    readonly userAgent?: string;
    readonly codecSupported?: boolean;
    readonly webgpu?: boolean;
  } = {},
): CapabilityReport {
  const probe = (available: boolean) => ({
    status: available ? ('supported' as const) : ('unsupported' as const),
    available,
  });
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-28T00:00:00.000Z',
    tier: 'b',
    environment: {
      userAgent: overrides.userAgent ?? 'not-a-browser-brand',
      platform: 'test',
      language: 'en',
      hardwareConcurrency: 4,
      deviceMemoryGiB: 8,
      crossOriginIsolated: true,
      secureContext: true,
      origin: 'https://example.invalid',
    },
    codecs: [
      {
        id: 'h264-decode-1080p30',
        kind: 'video-decoder',
        codec: 'avc1.42001f',
        supported: overrides.codecSupported ?? true,
        config: {},
        diagnostics: [],
      },
    ],
    gpu: {
      webgpu: probe(overrides.webgpu ?? false),
      webgl2: probe(true),
      offscreenCanvas: probe(true),
      worker: probe(true),
    },
    audio: {
      audioContext: probe(true),
      audioWorklet: probe(true),
      sharedArrayBuffer: probe(true),
    },
    storage: {
      opfs: probe(true),
      fileSystemAccess: probe(false),
      transferableStreams: probe(true),
    },
    color: {
      displayP3Gamut: probe(false),
      highDynamicRange: probe(false),
      localExecution: {
        workingColorSpaces: ['srgb-linear'],
        colorPrimaries: ['bt709'],
        transferFunctions: ['srgb'],
        matrixCoefficients: ['rgb'],
        colorRanges: ['full'],
        chromaSubsamplings: ['4:4:4'],
        alphaModes: ['premultiplied'],
        toneMappings: ['none'],
        bitDepths: [8],
        hdrPresentation: false,
      },
    },
    images: {
      avif: probe(true),
      jpeg: probe(true),
      png: probe(true),
      webp: probe(true),
    },
    wasm: { available: probe(true) },
    diagnostics: [],
  };
}

describe('capability gate', () => {
  it('accepts observed requirements without consulting user-agent strings', () => {
    const requirements = {
      codecIds: ['h264-decode-1080p30'],
      gpu: 'webgl2' as const,
      audioWorklet: true,
      opfs: true,
      sharedArrayBuffer: true,
      transferableStreams: true,
      secureContext: true,
      crossOriginIsolated: true,
    };
    expect(evaluateCapabilityGate(report({ userAgent: 'Browser A' }), requirements).ok).toBe(true);
    expect(evaluateCapabilityGate(report({ userAgent: 'Browser B' }), requirements).ok).toBe(true);
  });

  it('fails closed for absent or unsupported probes', () => {
    const result = evaluateCapabilityGate(report({ codecSupported: false, webgpu: false }), {
      codecIds: ['h264-decode-1080p30', 'missing-codec'],
      gpu: 'webgpu',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(value => value.code)).toEqual([
      'CAPABILITY_GATE_CODEC_UNSUPPORTED',
      'CAPABILITY_GATE_CODEC_UNSUPPORTED',
      'CAPABILITY_GATE_GPU_UNSUPPORTED',
    ]);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
  });
});
