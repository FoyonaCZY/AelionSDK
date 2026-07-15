import { renderIrAudio } from '@aelion/audio';
import type { JsonObject } from '@aelion/core';
import { SeekableMemorySink } from '@aelion/export';
import {
  compileMaterialGraphToWebGl2,
  type MaterialGraph,
  type WebGl2MaterialProgram,
} from '@aelion/material-compiler';
import { createSampleIndex, decodeAudioPcmRange, decodeVideoFrameAt } from '@aelion/media';
import type { IrMaterialDefinition } from '@aelion/render-ir';
import { describe, expect, it } from 'vitest';

import { Aelion, RuntimeMaterialRegistry, type AelionMediaProvider } from '../src/index.js';

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

describe('@aelion/sdk public browser facade', () => {
  it('loads, edits, previews and exports one frozen Project through public APIs', async () => {
    const [project, warmGraph, dissolveGraph, mp4, webm] = await Promise.all([
      json('/examples/aelion-vertical-slice-30s.project.json'),
      json('/examples/materials/warm-film/graphs/warm-film.graph.json'),
      json('/examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
      bytes('/fixtures/media/mp4-moov-head-h264-aac.mp4'),
      bytes('/fixtures/media/webm-vp9-opus-vfr.webm'),
    ]);
    const visualBytes = new Map([
      ['asset_opening', mp4],
      ['asset_closing', webm],
    ]);
    const music = await decodeAudioPcmRange(webm, 0, 3_000_000);
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
      pcmRange: (assetId, _streamIndex, startUs, durationUs) => {
        if (assetId !== 'asset_music') throw new Error(`Unknown audio asset ${assetId}`);
        const frameCount = Math.ceil((durationUs * music.sampleRate) / 1_000_000);
        const startFrame = Math.floor((startUs * music.sampleRate) / 1_000_000);
        const interleaved = new Float32Array(frameCount * music.channelCount);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const sourceFrame = (startFrame + frame) % music.frameCount;
          for (let channel = 0; channel < music.channelCount; channel += 1) {
            interleaved[frame * music.channelCount + channel] =
              music.interleaved[sourceFrame * music.channelCount + channel] ?? 0;
          }
        }
        return Promise.resolve({
          sampleRate: music.sampleRate,
          channelCount: music.channelCount,
          frameCount,
          interleaved,
        });
      },
    };
    const programs = new Map<string, WebGl2MaterialProgram>([
      [
        'warm-film',
        compileMaterialGraphToWebGl2(warmGraph as unknown as MaterialGraph, {
          parameters: { intensity: 'float' },
          inputPorts: { source: 'visual-frame' },
        }),
      ],
      [
        'cross-dissolve',
        compileMaterialGraphToWebGl2(dissolveGraph as unknown as MaterialGraph, {
          parameters: { curve: 'enum' },
          specializationValues: { curve: 'smooth' },
          inputPorts: { from: 'visual-frame', to: 'visual-frame' },
          systems: { transitionProgress: 'float' },
        }),
      ],
    ]);
    const materials = new RuntimeMaterialRegistry();
    for (const [materialId, program] of programs) {
      const instance = Object.values(project.materialInstances as JsonObject).find(value => {
        if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
        const definition = value.definition;
        return (
          definition !== null &&
          !Array.isArray(definition) &&
          typeof definition === 'object' &&
          definition.materialId === materialId
        );
      }) as { readonly definition: IrMaterialDefinition } | undefined;
      if (instance === undefined) throw new Error(`Missing Material ${materialId}`);
      materials.register(instance.definition, program);
    }
    const session = await Aelion.createSession({
      media,
      materials,
      preferredBackend: 'webgl2',
    });
    try {
      await session.loadProject(project);
      session.transaction.edit(edit => {
        edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.8);
      });
      let playerFrames = 0;
      const unsubscribe = session.player.subscribe(frame => {
        playerFrames += 1;
        frame.result.bitmap.close();
      });
      await session.player.seek(500_000);
      expect(session.player.currentTimeUs).toBeGreaterThanOrEqual(500_000);
      await session.player.play();
      await new Promise(resolve => globalThis.setTimeout(resolve, 120));
      await session.player.pause();
      unsubscribe();
      expect(session.player.state).toBe('paused');
      expect(playerFrames).toBeGreaterThan(0);
      const preview = await session.preview.renderFrame({ timeUs: 15_000_000 });
      try {
        expect(preview.bitmap.width).toBe(320);
        expect(preview.materialIds).toEqual(['mat_warm', 'mat_dissolve']);
      } finally {
        preview.bitmap.close();
      }

      // Keep the consumer export short while proving that the public facade
      // freezes the edited IR and supplies both render callbacks itself.
      session.transaction.edit(edit => {
        edit.setField('sequences', 'seq_vertical', ['duration', 'durationUs'], 1_000_000);
        edit.setField('items', 'item_music', ['range', 'durationUs'], 1_000_000);
      });
      const sink = new SeekableMemorySink();
      const preflight = await session.export.preflight({ sink: sink.writable });
      expect(preflight.ok).toBe(true);
      const exportJob = session.export.start({
        sink: sink.writable,
        videoBitrate: 500_000,
        audioBitrate: 64_000,
      });
      expect(session.export.activeJob).toBe(exportJob);
      expect(exportJob.state).toBe('running');
      const exported = await exportJob;
      expect(exportJob.state).toBe('completed');
      expect(exportJob.getSnapshot().progress).toBe(1);
      const output = sink.finalize();
      const index = await createSampleIndex(output);
      expect(exported.videoFrames).toBe(30);
      expect(index.container).toBe('webm');
      expect(index.tracks.some(track => track.kind === 'video')).toBe(true);
      expect(index.tracks.some(track => track.kind === 'audio')).toBe(true);
      // The SDK export path and public mixer use the same IR time base.
      const renderIr = session.getSnapshot().renderIr;
      if (renderIr === null) throw new Error('Session Render IR is missing');
      await expect(
        renderIrAudio({
          ir: renderIr,
          startFrame: 0,
          frameCount: 128,
          channelCount: 2,
          source: media,
        }),
      ).resolves.toHaveLength(256);
    } finally {
      music.interleaved.fill(0);
      await session.dispose();
    }
  }, 30_000);
});
