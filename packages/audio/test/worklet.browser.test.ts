import { describe, expect, it } from 'vitest';

import {
  audioContextStateTransition,
  AudioWorkletClock,
  measureAvSync,
  TransferableAudioWorkletClock,
} from '../src/index.js';

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
  }
}

describe('AudioWorklet master clock', () => {
  it('requests a configured sequence sample rate for owned contexts', async () => {
    const clock = new AudioWorkletClock({ sampleRate: 44_100 });
    try {
      expect(clock.context.sampleRate).toBe(44_100);
    } finally {
      await clock.dispose();
    }
    const transferable = new TransferableAudioWorkletClock({ sampleRate: 44_100 });
    try {
      expect(transferable.context.sampleRate).toBe(44_100);
    } finally {
      await transferable.dispose();
    }
  });

  it('defines interruption and hardware-clock recovery transitions', () => {
    expect(audioContextStateTransition('running', 'interrupted')).toBe('interrupted');
    expect(audioContextStateTransition('interrupted', 'running')).toBe('resumed');
    expect(audioContextStateTransition('running', 'suspended')).toBeUndefined();
    expect(audioContextStateTransition('suspended', 'running')).toBeUndefined();
  });

  it('consumes a bounded PCM ring and advances the hardware clock without underrun', async () => {
    const clock = new AudioWorkletClock({
      capacityFrames: 96_000,
      channelCount: 2,
    });
    const seconds = 0.5;
    const frames = Math.floor(clock.context.sampleRate * seconds);
    const pcm = new Float32Array(frames * 2);
    const events: string[] = [];
    clock.subscribe(event => events.push(event.type));
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = Math.sin((frame * 2 * Math.PI * 440) / clock.context.sampleRate) * 0.01;
      pcm[frame * 2] = sample;
      pcm[frame * 2 + 1] = sample;
    }
    expect(clock.ring.writeInterleaved(pcm)).toBe(frames);

    try {
      await clock.start();
      const startUs = clock.nowUs();
      await waitUntil(
        () => clock.nowUs() > startUs && clock.ring.snapshot().playedFrames > 0,
        'the SharedArrayBuffer AudioWorklet hardware clock',
      );
      const endUs = clock.nowUs();
      expect(endUs).toBeGreaterThan(startUs);
      expect(clock.ring.snapshot().playedFrames).toBeGreaterThan(0);
      expect(clock.ring.snapshot().underrunFrames).toBe(0);
      const playedFrames = clock.ring.snapshot().playedFrames;
      const av = measureAvSync(clock.nowUs(), playedFrames, clock.context.sampleRate);
      expect(Math.abs(av.driftUs)).toBeLessThan(100_000);
      await clock.pause();
      await clock.resume();
      await clock.pause();
      expect(clock.resetForSeek(2_000_000)).toBe(1);
      expect(clock.nowUs()).toBeGreaterThanOrEqual(2_000_000);
      expect(clock.ring.snapshot()).toMatchObject({
        availableReadFrames: 0,
        playedFrames: 0,
        underrunFrames: 0,
      });
    } finally {
      await clock.dispose();
    }
    expect(clock.disposed).toBe(true);
    expect(clock.context.state).toBe('closed');
    expect(events).toEqual(['started', 'paused', 'resumed', 'paused', 'seeked']);
  });
});

describe('non-isolated AudioWorklet fallback', () => {
  it('uses a bounded acknowledged Transferable queue without SAB', async () => {
    const clock = new TransferableAudioWorkletClock({
      capacityFrames: 48_000,
      channelCount: 2,
    });
    const frames = 24_000;
    const pcm = new Float32Array(frames * 2);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = Math.sin((frame * 2 * Math.PI * 220) / clock.context.sampleRate) * 0.01;
      pcm[frame * 2] = sample;
      pcm[frame * 2 + 1] = sample;
    }
    try {
      await clock.initialize(1_024);
      expect(clock.enqueueInterleaved(pcm)).toBe(true);
      await clock.start();
      await waitUntil(
        () => (clock.lastReport?.playedFrames ?? 0) > 0,
        'the transferable AudioWorklet clock report',
      );
      expect(clock.lastReport?.playedFrames).toBeGreaterThan(0);
      expect(clock.lastReport?.underrunFrames).toBe(0);
      expect(clock.snapshot().peakQueuedFrames).toBe(frames);
      expect(clock.seek(1_000_000)).toBe(1);
      expect(clock.snapshot().queuedFrames).toBe(0);
      await clock.pause();
    } finally {
      await clock.dispose();
    }
    expect(clock.disposed).toBe(true);
    expect(clock.context.state).toBe('closed');
  });
});

describe('AudioWorklet transport disposal', () => {
  it.each(['shared-ring', 'transferable-queue'] as const)(
    'drops buffered frames when %s disposal races active consumption',
    async mode => {
      const capacityFrames = 48_000;
      const clock =
        mode === 'shared-ring'
          ? new AudioWorkletClock({ capacityFrames, channelCount: 2 })
          : new TransferableAudioWorkletClock({ capacityFrames, channelCount: 2 });
      await clock.start();

      const pcm = new Float32Array(capacityFrames * 2);
      const accepted =
        clock instanceof AudioWorkletClock
          ? clock.ring.writeInterleaved(pcm) === capacityFrames
          : clock.enqueueInterleaved(pcm);
      expect(accepted).toBe(true);

      const before =
        clock instanceof AudioWorkletClock
          ? clock.ring.snapshot().availableReadFrames
          : clock.snapshot().queuedFrames;
      expect(before).toBeGreaterThan(0);

      const disposal = clock.dispose();
      const during = clock instanceof AudioWorkletClock ? clock.ring.snapshot() : clock.snapshot();
      expect(
        'availableReadFrames' in during ? during.availableReadFrames : during.queuedFrames,
      ).toBe(0);
      expect('state' in during ? during.state : during.closed ? 'closed' : 'open').toBe('closed');

      await disposal;
      const terminal =
        clock instanceof AudioWorkletClock ? clock.ring.snapshot() : clock.snapshot();
      expect(
        'availableReadFrames' in terminal ? terminal.availableReadFrames : terminal.queuedFrames,
      ).toBe(0);
      expect('state' in terminal ? terminal.state : terminal.closed ? 'closed' : 'open').toBe(
        'closed',
      );
      expect(clock.disposed).toBe(true);
      expect(clock.context.state).toBe('closed');
    },
  );
});
