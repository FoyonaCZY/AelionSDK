import { describe, expect, it } from 'vitest';

import { selectBrowserAudioTransport, TransferablePcmQueue } from '../src/index.js';

describe('TransferablePcmQueue', () => {
  it('enforces bounded ownership until AudioWorklet acknowledgement', () => {
    const queue = new TransferablePcmQueue(8, 2);
    const first = queue.enqueue(new Float32Array(8), 0);
    const second = queue.enqueue(new Float32Array(8), 0);
    expect(first?.frameCount).toBe(4);
    expect(second?.frameCount).toBe(4);
    expect(queue.enqueue(new Float32Array(2), 0)).toBeUndefined();
    expect(queue.snapshot()).toMatchObject({ queuedFrames: 8, peakQueuedFrames: 8 });
    queue.acknowledge(first?.id ?? -1);
    expect(queue.snapshot()).toMatchObject({
      queuedFrames: 4,
      availableWriteFrames: 4,
      acknowledgedBlocks: 1,
    });
  });

  it('drops all pending transferable blocks when closed', () => {
    const queue = new TransferablePcmQueue(8, 2);
    expect(queue.enqueue(new Float32Array(8), 0)?.frameCount).toBe(4);

    queue.close();

    expect(queue.snapshot()).toMatchObject({
      queuedFrames: 0,
      availableWriteFrames: 8,
      closed: true,
    });
  });

  it('selects the non-isolated fallback without changing audio semantics', () => {
    expect(
      selectBrowserAudioTransport({
        crossOriginIsolated: false,
        sharedArrayBufferAvailable: true,
      }),
    ).toEqual({ mode: 'transferable-queue', reason: 'shared-array-buffer-unavailable' });
    expect(
      selectBrowserAudioTransport({
        crossOriginIsolated: true,
        sharedArrayBufferAvailable: true,
      }),
    ).toEqual({ mode: 'shared-ring', reason: 'cross-origin-isolated' });
  });
});
