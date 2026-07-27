import { describe, expect, it } from 'vitest';

import { probeCapabilities } from '@aelionsdk/capability';
import { EXPORT_PROFILES } from '@aelionsdk/export';

declare const __AELION_CONFORMANCE_TARGET__: 'webkit' | 'mobile' | undefined;

describe('target browser public-contract conformance', () => {
  it('keeps capability failures structured and all production profiles discoverable', async () => {
    const report = await probeCapabilities();
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(report.codecs).toHaveLength(12);
    expect(Object.keys(EXPORT_PROFILES)).toEqual(
      expect.arrayContaining(['webm-vp9-opus', 'mp4-h264-aac', 'mp4-av1-aac', 'mp4-hevc-aac']),
    );
    for (const codec of report.codecs) {
      expect(typeof codec.supported).toBe('boolean');
      if (!codec.supported) expect(codec.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('honors the emulated mobile viewport and touch contract', () => {
    if (
      typeof __AELION_CONFORMANCE_TARGET__ === 'undefined' ||
      __AELION_CONFORMANCE_TARGET__ !== 'mobile'
    ) {
      return;
    }
    // Vitest hosts tests in an iframe whose CSS viewport can be slightly wider
    // than the Playwright device viewport; screen remains the emulated device.
    expect(screen.width).toBe(390);
    expect(screen.height).toBe(844);
    expect(innerWidth).toBeLessThanOrEqual(430);
    expect(navigator.maxTouchPoints).toBeGreaterThan(0);
    expect(devicePixelRatio).toBe(3);
  });
});
