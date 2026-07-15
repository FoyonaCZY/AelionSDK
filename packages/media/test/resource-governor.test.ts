import { describe, expect, it } from 'vitest';

import { PageMediaResourceGovernor } from '../src/index.js';

describe('PageMediaResourceGovernor', () => {
  it('bounds allocations and admits queued export work before background work', async () => {
    const governor = new PageMediaResourceGovernor({
      decoderSlots: 2,
      gpuBytes: 100,
      cacheBytes: 1_000,
    });
    const first = await governor.acquire({
      ownerId: 'preview-a',
      priority: 'preview',
      decoderSlots: 2,
      gpuBytes: 100,
      cacheBytes: 500,
    });
    const order: string[] = [];
    const background = governor
      .acquire({
        ownerId: 'thumbs',
        priority: 'background',
        decoderSlots: 1,
        gpuBytes: 20,
        cacheBytes: 100,
      })
      .then(lease => {
        order.push(lease.ownerId);
        return lease;
      });
    const exported = governor
      .acquire({
        ownerId: 'export',
        priority: 'export',
        decoderSlots: 1,
        gpuBytes: 20,
        cacheBytes: 100,
      })
      .then(lease => {
        order.push(lease.ownerId);
        return lease;
      });
    expect(governor.snapshot()).toMatchObject({ activeLeases: 1, pendingRequests: 2 });
    void first.dispose();
    const exportLease = await exported;
    expect(order[0]).toBe('export');
    void exportLease.dispose();
    const backgroundLease = await background;
    void backgroundLease.dispose();
    expect(governor.snapshot().used).toEqual({ decoderSlots: 0, gpuBytes: 0, cacheBytes: 0 });
  });

  it('removes cancelled waiters and releases every lease on dispose', async () => {
    const governor = new PageMediaResourceGovernor({
      decoderSlots: 1,
      gpuBytes: 10,
      cacheBytes: 10,
    });
    const lease = await governor.acquire({
      ownerId: 'active',
      priority: 'preview',
      decoderSlots: 1,
      gpuBytes: 10,
      cacheBytes: 10,
    });
    const controller = new AbortController();
    const waiting = governor.acquire(
      {
        ownerId: 'waiting',
        priority: 'preview',
        decoderSlots: 1,
        gpuBytes: 1,
        cacheBytes: 1,
      },
      controller.signal,
    );
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(governor.snapshot().pendingRequests).toBe(0);
    governor.dispose();
    expect(lease.disposed).toBe(true);
    expect(governor.snapshot()).toMatchObject({ disposed: true, activeLeases: 0 });
  });
});
