import type { PcmSourceBlock } from '@aelion/audio';
import type { AelionProject } from '@aelion/project-schema';
import { describe, expect, it } from 'vitest';

import { Aelion, type AelionMediaProvider } from '../src/index.js';

async function project(): Promise<AelionProject> {
  const response = await fetch('/examples/aelion-vertical-slice-30s.project.json');
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status.toString()}`);
  const value = (await response.json()) as AelionProject;
  const sequence = value.sequences.seq_vertical;
  const videoTrack = value.tracks.track_video;
  const audioTrack = value.tracks.track_audio;
  const opening = value.items.item_opening;
  const music = value.items.item_music;
  if (
    sequence === undefined ||
    videoTrack === undefined ||
    audioTrack === undefined ||
    opening === undefined ||
    music === undefined
  ) {
    throw new Error('Player race fixture is incomplete');
  }
  sequence.duration = { mode: 'fixed', durationUs: 2_000_000, overflow: 'clip' };
  sequence.transitionIds = [];
  videoTrack.itemIds = ['item_opening'];
  opening.range = { startUs: 0, durationUs: 2_000_000 };
  opening.materialInstanceIds = [];
  music.range = { startUs: 0, durationUs: 2_000_000 };
  value.items = { item_opening: opening, item_music: music };
  value.materialInstances = {};
  value.transitions = {};
  return value;
}

function frame(timestampUs: number): VideoFrame {
  const canvas = new OffscreenCanvas(16, 16);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context is unavailable');
  context.fillStyle = 'rgb(20 40 80)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return new VideoFrame(canvas, { timestamp: timestampUs });
}

function pcm(durationUs: number): PcmSourceBlock {
  const frameCount = Math.ceil((durationUs * 48_000) / 1_000_000);
  return {
    sampleRate: 48_000,
    channelCount: 2,
    frameCount,
    interleaved: new Float32Array(frameCount * 2).fill(0.01),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for Player race state');
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));
  }
}

describe('AelionPlayer asynchronous generations', () => {
  it('cannot resume play or pause continuations after disposal starts', async () => {
    let releaseFill: ((value: PcmSourceBlock) => void) | undefined;
    const media: AelionMediaProvider = {
      frameAt: (assetId, streamIndex, sourceTimeUs) => {
        void assetId;
        void streamIndex;
        return Promise.resolve(frame(sourceTimeUs));
      },
      pcmRange: () =>
        new Promise(resolve => {
          releaseFill = resolve;
        }),
    };
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    await session.loadProject(await project());
    const playing = session.player.play();
    await waitFor(() => releaseFill !== undefined);
    const disposal = session.dispose();
    releaseFill?.(pcm(100_000));

    await expect(playing).rejects.toSatisfy((error: unknown) => {
      if (error === null || typeof error !== 'object') return false;
      if (Reflect.get(error, 'name') === 'AbortError') return true;
      const diagnostics: unknown = Reflect.get(error, 'diagnostics');
      return (
        Array.isArray(diagnostics) &&
        diagnostics.some(value =>
          value !== null && typeof value === 'object'
            ? Reflect.get(value, 'code') === 'OPERATION_ABORTED'
            : false,
        )
      );
    });
    await disposal;
    await new Promise(resolve => globalThis.setTimeout(resolve, 50));
    expect(session.player.getStats()).toMatchObject({
      state: 'disposed',
      resources: {
        audioFillScheduled: false,
        audioFillInFlight: false,
        scheduler: { present: false, scheduled: false },
      },
    });
    await expect(session.player.pause()).rejects.toThrow('disposed');
  });

  it('closes an owned frame and enters error state when its subscriber throws', async () => {
    const media: AelionMediaProvider = {
      frameAt: (_assetId, _streamIndex, sourceTimeUs) => Promise.resolve(frame(sourceTimeUs)),
      pcmRange: (_assetId, _streamIndex, _startUs, durationUs) => Promise.resolve(pcm(durationUs)),
    };
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    const diagnostics: string[] = [];
    session.subscribe('diagnostic', event => diagnostics.push(event.diagnostic.code));
    const unsubscribe = session.player.subscribe(() => {
      throw new Error('consumer frame callback failed');
    });
    try {
      await session.loadProject(await project());
      await session.player.seek(0);
      expect(session.player.getStats()).toMatchObject({
        state: 'error',
        errors: 1,
        lastErrorCode: 'PLAYER_RUNTIME_FAILED',
      });
      expect(diagnostics).toContain('PLAYER_RUNTIME_FAILED');
    } finally {
      unsubscribe();
      await session.dispose();
    }
  });

  it('does not enqueue or publish a stale PCM generation after a newer seek', async () => {
    let releaseFirst: ((value: PcmSourceBlock) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    let delayed = true;
    const starts: number[] = [];
    const media: AelionMediaProvider = {
      frameAt: (_assetId, _streamIndex, sourceTimeUs) => Promise.resolve(frame(sourceTimeUs)),
      pcmRange: (_assetId, _streamIndex, startUs, durationUs, signal) => {
        starts.push(startUs);
        if (delayed) {
          delayed = false;
          firstSignal = signal;
          return new Promise(resolve => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(pcm(durationUs));
      },
    };
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(await project());
      const first = session.player.seek(0);
      const firstResult = first.then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      );
      await waitFor(() => releaseFirst !== undefined);
      const second = session.player.seek(500_000);
      releaseFirst?.(pcm(100_000));
      await waitFor(() => firstSignal?.aborted === true);
      await second;
      expect(await firstResult).toBe('rejected');

      expect(starts[0]).toBe(0);
      expect(starts[1]).toBe(500_000);
      expect(session.player.currentTimeUs).toBeGreaterThanOrEqual(500_000);
      expect(session.player.getStats()).toMatchObject({ generation: 3, errors: 0 });
    } finally {
      await session.dispose();
    }
  });

  it('aborts and drains an in-flight PCM fill before Session disposal completes', async () => {
    let release: ((value: PcmSourceBlock) => void) | undefined;
    let signal: AbortSignal | undefined;
    const media: AelionMediaProvider = {
      frameAt: (_assetId, _streamIndex, sourceTimeUs) => Promise.resolve(frame(sourceTimeUs)),
      pcmRange: (_assetId, _streamIndex, _startUs, _durationUs, fillSignal) => {
        signal = fillSignal;
        return new Promise(resolve => {
          release = resolve;
        });
      },
    };
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    await session.loadProject(await project());
    // Exercise a real Renderer before disposal so the terminal Renderer
    // snapshot below proves cleanup of an actually created Worker runtime.
    const preview = await session.preview.renderFrame({ timeUs: 0 });
    preview.bitmap.close();
    const seek = session.player.seek(0);
    const seekResult = seek.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    await waitFor(() => release !== undefined);
    const dispose = session.dispose();
    await waitFor(() => signal?.aborted === true);
    release?.(pcm(100_000));

    expect(await seekResult).toBe('rejected');
    await dispose;
    expect(session.state).toBe('disposed');
    expect(session.player.getStats()).toMatchObject({
      state: 'disposed',
      errors: 0,
      resources: {
        listeners: 0,
        runtimeInitializing: false,
        audioFillScheduled: false,
        audioFillInFlight: false,
        scheduler: { present: false, disposed: true, scheduled: false, rendering: false },
        audio: {
          mode: 'none',
          disposed: true,
          contextState: null,
          bufferedFrames: 0,
          closed: true,
        },
        lastDisposedRuntime: {
          schedulerDisposed: true,
          audioDisposed: true,
          audioContextClosed: true,
          transportClosed: true,
          bufferedFrames: 0,
        },
      },
    });
    expect(session.getStats().preview).toMatchObject({
      rendererPresent: false,
      rendererDisposed: true,
      pendingFrames: 0,
      workerPendingRequests: 0,
      workerActiveRequests: 0,
      workerCancelledRequests: 0,
      lastDisposedRenderer: {
        disposed: true,
        pendingFrames: 0,
        workerDisposed: true,
        workerPendingRequests: 0,
        workerActiveRequests: 0,
        workerCancelledRequests: 0,
      },
    });
  });
});
