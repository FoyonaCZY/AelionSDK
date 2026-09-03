import type { JsonObject } from '@aelionsdk/core';
import { decodeVideoFrameAt } from '@aelionsdk/media';
import { describe, expect, it } from 'vitest';

import { Aelion, createGapItem, type AelionMediaProvider } from '../src/index.js';

async function json(path: string): Promise<JsonObject> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status.toString()}`);
  return response.json() as Promise<JsonObject>;
}

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status.toString()}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function harness(): Promise<{
  readonly project: JsonObject;
  readonly media: AelionMediaProvider;
}> {
  const [project, mp4, webm] = await Promise.all([
    json('/examples/aelion-vertical-slice-30s.project.json'),
    bytes('/fixtures/media/mp4-moov-head-h264-aac.mp4'),
    bytes('/fixtures/media/webm-vp9-opus-vfr.webm'),
  ]);
  // These tests are about preview boundaries, not the Material runtime, so the
  // fixture's effect and transition are removed rather than compiled.
  const items = project.items as JsonObject;
  for (const item of Object.values(items)) {
    (item as JsonObject).materialInstanceIds = [];
  }
  project.transitions = {};
  project.materialInstances = {};
  for (const sequence of Object.values(project.sequences as JsonObject)) {
    const value = sequence as JsonObject;
    value.transitionIds = [];
    value.materialInstanceIds = [];
  }
  const visualBytes = new Map([
    ['asset_opening', mp4],
    ['asset_closing', webm],
  ]);
  const media: AelionMediaProvider = {
    frameAt: async (assetId, _streamIndex, sourceTimeUs, signal) => {
      const source = visualBytes.get(assetId);
      if (source === undefined) throw new Error(`Unknown visual asset ${assetId}`);
      const decoded = await decodeVideoFrameAt(source, sourceTimeUs, {
        maxDecodeQueueSize: 8,
        ...(signal === undefined ? {} : { signal }),
      });
      try {
        const bitmap = await createImageBitmap(decoded.frame);
        try {
          return new VideoFrame(bitmap, { timestamp: sourceTimeUs });
        } finally {
          bitmap.close();
        }
      } finally {
        decoded.close();
      }
    },
    pcmRange: () => Promise.reject(new Error('audio is not exercised here')),
  };
  return { project, media };
}

describe('preview speculation and boundaries', () => {
  it('renders an edit that was never committed, then forgets it', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const revision = session.revision;
      const ir = session.getSnapshot().renderIr;

      // Past the end of the committed Sequence, so the only way a frame exists
      // at this time is if the overlay lengthened it.
      const beyondUs = (ir?.durationUs ?? 0) + 2_000_000;
      const speculative = await session.preview.renderFrame({
        timeUs: beyondUs,
        overlay: transaction => {
          transaction.setField('items', 'item_closing', ['range', 'durationUs'], 20_000_000);
        },
      });
      try {
        expect(speculative.width).toBeGreaterThan(0);
      } finally {
        speculative.bitmap.close();
      }

      expect(session.revision).toBe(revision);
      expect(session.getSnapshot().renderIr).toBe(ir);
      expect(session.transaction.canUndo).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it('clamps a playhead parked past the end instead of refusing the frame', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const durationUs = session.getSnapshot().renderIr?.durationUs ?? 0;
      const diagnostics: string[] = [];
      session.subscribe('diagnostic', event => diagnostics.push(event.diagnostic.code));
      // Exactly the duration is one microsecond past the last frame, which is
      // where a playhead sits after playing to the end.
      const frame = await session.preview.renderFrame({ timeUs: durationUs });
      try {
        expect(frame.width).toBeGreaterThan(0);
      } finally {
        frame.bitmap.close();
      }
      expect(diagnostics).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('answers an empty Sequence with its background instead of an error', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const snapshot = session.getSnapshot().project;
      if (snapshot === null) throw new Error('Project was not loaded');
      // Empty every Track: a new Project, or one whose last clip was deleted.
      session.transaction.edit(transaction => {
        for (const sequence of Object.values(snapshot.sequences)) {
          transaction.setField('sequences', sequence.id, ['duration'], { mode: 'content' });
        }
        for (const track of Object.values(snapshot.tracks)) {
          transaction.setField('tracks', track.id, ['itemIds'], []);
        }
        for (const id of Object.keys(snapshot.items)) transaction.deleteEntity('items', id);
        for (const sequence of Object.values(snapshot.sequences)) {
          transaction.setField('sequences', sequence.id, ['transitionIds'], []);
        }
        for (const id of Object.keys(snapshot.transitions)) {
          transaction.deleteEntity('transitions', id);
        }
      });
      expect(session.getSnapshot().renderIr?.durationUs).toBe(0);
      const frame = await session.preview.renderFrame({ timeUs: 0 });
      try {
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
      } finally {
        frame.bitmap.close();
      }
    } finally {
      await session.dispose();
    }
  });

  it('keeps a Gap as blank time that lengthens the Sequence without drawing', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const loaded = session.getSnapshot().project;
      if (loaded === null) throw new Error('Project was not loaded');
      // The fixture pins its Sequence to a fixed length; a Gap only shows up in
      // the duration when that is derived from content.
      session.transaction.edit(transaction => {
        for (const sequence of Object.values(loaded.sequences)) {
          transaction.setField('sequences', sequence.id, ['duration'], { mode: 'content' });
        }
      });
      const before = session.getSnapshot().renderIr?.durationUs ?? 0;
      const snapshot = session.getSnapshot().project;
      if (snapshot === null) throw new Error('Project was not loaded');
      const trackId = Object.values(snapshot.tracks).find(track => track.kind === 'visual')?.id;
      if (trackId === undefined) throw new Error('No visual Track');
      session.transaction.commands.insertItem({
        item: createGapItem({
          id: 'item_pause',
          trackId,
          atUs: before + 1_000_000,
          durationUs: 3_000_000,
        }),
      });
      expect(session.getSnapshot().renderIr?.durationUs).toBe(before + 4_000_000);
      const frame = await session.preview.renderFrame({ timeUs: before + 2_000_000 });
      try {
        expect(frame.width).toBeGreaterThan(0);
      } finally {
        frame.bitmap.close();
      }
    } finally {
      await session.dispose();
    }
  });
});

describe('media sampling', () => {
  it('composes a filmstrip across an Item and hands back one bitmap', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const strip = await session.media.filmstrip({
        itemId: 'item_opening',
        count: 4,
        frameHeight: 32,
      });
      try {
        expect(strip.frameCount).toBe(4);
        expect(strip.frameHeight).toBe(32);
        expect(strip.bitmap.width).toBe(strip.frameWidth * 4);
        expect(strip.bitmap.height).toBe(32);
        // Sampled through the Item's own time mapping, in order.
        expect(strip.timesUs).toHaveLength(4);
        expect([...strip.timesUs].sort((a, b) => a - b)).toEqual([...strip.timesUs]);
      } finally {
        strip.bitmap.close();
      }
    } finally {
      await session.dispose();
    }
  });

  it('right-sizes a thumbnail to the requested maximum dimension', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const bitmap = await session.media.thumbnail({ assetId: 'asset_opening', maxDimension: 64 });
      try {
        expect(Math.max(bitmap.width, bitmap.height)).toBeLessThanOrEqual(64);
        expect(Math.min(bitmap.width, bitmap.height)).toBeGreaterThan(0);
      } finally {
        bitmap.close();
      }
    } finally {
      await session.dispose();
    }
  });

  it('cancels a filmstrip without disturbing the preview decoder', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      const controller = new AbortController();
      const pending = session.media.filmstrip({
        itemId: 'item_opening',
        count: 8,
        frameHeight: 32,
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toThrow();
      // Preview still works, which is the point of the transient budget.
      const frame = await session.preview.renderFrame({ timeUs: 1_000_000 });
      frame.bitmap.close();
    } finally {
      await session.dispose();
    }
  });

  it('bounds filmstrip allocation before starting decode', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    try {
      await session.loadProject(project);
      await expect(session.media.filmstrip({ itemId: 'item_opening', count: 129 })).rejects.toThrow(
        /1 to 128/u,
      );
      await expect(
        session.media.filmstrip({ itemId: 'item_opening', count: 1, frameHeight: Infinity }),
      ).rejects.toThrow(/1 to 512/u);
    } finally {
      await session.dispose();
    }
  });

  it('cancels queued media sampling when the Session is disposed', async () => {
    const { project, media } = await harness();
    const session = await Aelion.createSession({ media, preferredBackend: 'webgl2' });
    await session.loadProject(project);
    const pending = session.media.filmstrip({ itemId: 'item_opening', count: 8 });
    await session.dispose();
    await expect(pending).rejects.toThrow(/abort/iu);
  });
});
