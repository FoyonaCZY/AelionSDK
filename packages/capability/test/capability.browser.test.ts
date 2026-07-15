import { describe, expect, it } from 'vitest';

import { probeCapabilities } from '../src/index.js';

describe('browser capability report', () => {
  it('probes real browser configurations and returns a serializable report', async () => {
    const report = await probeCapabilities({ includeAdapterDetails: true });

    expect(report.schemaVersion).toBe('1.0.0');
    expect(report.environment.secureContext).toBe(true);
    expect(report.environment.crossOriginIsolated).toBe(true);
    expect(report.environment.userAgent.length).toBeGreaterThan(0);
    expect(report.codecs).toHaveLength(8);
    expect(report.codecs.some(codec => codec.kind === 'video-decoder')).toBe(true);
    expect(report.codecs.some(codec => codec.kind === 'video-encoder')).toBe(true);
    expect(report.gpu.worker.available).toBe(true);
    expect(report.gpu.offscreenCanvas.available).toBe(true);
    expect(report.audio.audioContext.available).toBe(true);
    expect(report.storage.transferableStreams.available).toBe(true);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it('reports unsupported configurations instead of silently omitting them', async () => {
    const report = await probeCapabilities();
    for (const codec of report.codecs) {
      expect(codec).toHaveProperty('supported');
      expect(codec).toHaveProperty('diagnostics');
      if (!codec.supported) expect(codec.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
