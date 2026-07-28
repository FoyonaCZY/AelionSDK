import { describe, expect, it } from 'vitest';

import { AelionSession } from '../src/index.js';

describe('privacy-safe Session diagnostic reports', () => {
  it('exports JSON-safe counters and redacts free-form diagnostic content by default', async () => {
    const session = new AelionSession({
      media: {
        frameAt: () => Promise.reject(new Error('not used')),
        pcmRange: () => Promise.reject(new Error('not used')),
        getDiagnosticSnapshot: () => ({ activeOperations: 0, pendingOperations: 0 }),
      },
    });
    await expect(session.loadProject({ projectId: 'private-project-name' })).rejects.toThrow();

    const safe = session.createDiagnosticReport();
    expect(safe).toMatchObject({
      schemaVersion: '1.0.0',
      privacy: 'safe',
      session: { state: 'empty', revision: null },
      media: { activeOperations: 0, pendingOperations: 0 },
      stats: {
        timings: {
          projectLoad: { count: 1, succeeded: 0, failed: 1, cancelled: 0 },
        },
      },
    });
    expect(safe.diagnostics.length).toBeGreaterThan(0);
    expect(safe.diagnostics[0]).not.toHaveProperty('message');
    expect(safe.diagnostics[0]).not.toHaveProperty('entityId');
    expect(safe.diagnostics[0]).not.toHaveProperty('details');
    expect(() => JSON.stringify(safe)).not.toThrow();

    const full = session.createDiagnosticReport({ privacy: 'full' });
    expect(full.diagnostics[0]).toHaveProperty('message');
    expect(full.diagnostics[0]).not.toHaveProperty('cause');
    await session.dispose();
  });

  it('survives a failing custom media inspection hook', () => {
    const session = new AelionSession({
      media: {
        frameAt: () => Promise.reject(new Error('not used')),
        pcmRange: () => Promise.reject(new Error('not used')),
        getDiagnosticSnapshot: () => {
          throw new Error('inspection unavailable');
        },
      },
    });
    expect(session.createDiagnosticReport().media).toBeNull();
  });

  it('excludes capability fingerprints and probe details unless full output is requested', async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'navigator');
    const session = new AelionSession();
    try {
      await session.probeCapabilities();

      const safeJson = JSON.stringify(session.createDiagnosticReport().capability);
      expect(safeJson).not.toContain('userAgent');
      expect(safeJson).not.toContain('"platform"');
      expect(safeJson).not.toContain('"adapter"');
      expect(safeJson).not.toContain('"details"');
      expect(safeJson).not.toContain('"diagnostics"');

      const fullJson = JSON.stringify(session.createDiagnosticReport({ privacy: 'full' }));
      expect(fullJson).toContain('"userAgent":"unavailable"');
      expect(fullJson).toContain('"platform":"unknown"');
    } finally {
      await session.dispose();
      if (navigatorDescriptor !== undefined) {
        Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
      }
    }
  });
});
