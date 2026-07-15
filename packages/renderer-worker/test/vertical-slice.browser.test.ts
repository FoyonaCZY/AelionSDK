import type { JsonObject } from '@aelion/core';
import { renderIrAudio } from '@aelion/audio';
import {
  compileMaterialGraphToWebGl2,
  type MaterialGraph,
  type WebGl2MaterialProgram,
} from '@aelion/material-compiler';
import { decodeAudioPcmRange, decodeVideoFrameAt } from '@aelion/media';
import type { AelionProject } from '@aelion/project-schema';
import { IncrementalRenderCompiler, type IrMaterialDefinition } from '@aelion/render-ir';
import { describe, expect, it } from 'vitest';

import { RenderIrFrameRenderer, type IrFrameSource } from '../src/index.js';
import { hasUsableWebGpu } from './browser-capabilities.js';

async function fixtureJson(path: string): Promise<JsonObject> {
  const response = await fetch(`/${path}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  return response.json() as Promise<JsonObject>;
}

async function fixtureBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`/${path}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function parameterTypes(materialId: string) {
  return materialId === 'warm-film'
    ? ({ parameters: { intensity: 'float' }, inputPorts: { source: 'visual-frame' } } as const)
    : ({
        parameters: { curve: 'enum' },
        specializationValues: { curve: 'smooth' },
        inputPorts: { from: 'visual-frame', to: 'visual-frame' },
        systems: { transitionProgress: 'float' },
      } as const);
}

describe('fixed 30-second Project vertical slice', () => {
  it('loads real MP4/WebM frames and executes Filter + Transition through one Render IR', async () => {
    const preferredBackend = (await hasUsableWebGpu()) ? 'webgpu' : 'webgl2';
    const [project, warmGraph, transitionGraph, opening, closing] = await Promise.all([
      fixtureJson('examples/aelion-vertical-slice-30s.project.json'),
      fixtureJson('examples/materials/warm-film/graphs/warm-film.graph.json'),
      fixtureJson('examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
      fixtureBytes('fixtures/media/mp4-moov-head-h264-aac.mp4'),
      fixtureBytes('fixtures/media/webm-vp9-opus-vfr.webm'),
    ]);
    const programs = new Map<string, WebGl2MaterialProgram>([
      [
        'warm-film',
        compileMaterialGraphToWebGl2(warmGraph as MaterialGraph, parameterTypes('warm-film')),
      ],
      [
        'cross-dissolve',
        compileMaterialGraphToWebGl2(
          transitionGraph as MaterialGraph,
          parameterTypes('cross-dissolve'),
        ),
      ],
    ]);
    const resolver = (definition: IrMaterialDefinition): WebGl2MaterialProgram | undefined =>
      programs.get(definition.materialId);
    const ir = new IncrementalRenderCompiler().compile(
      project as unknown as AelionProject,
      'seq_vertical',
      0n,
      { resolveMaterialProgram: resolver },
    ).ir;
    const cache = new Map<string, Uint8Array>([
      ['asset_opening', opening],
      ['asset_closing', closing],
      ['asset_music', closing],
    ]);
    const source: IrFrameSource = {
      frameAt: async (assetId, _streamIndex, sourceTimeUs, signal) => {
        const bytes = cache.get(assetId);
        if (bytes === undefined) throw new Error(`Unknown visual asset ${assetId}`);
        const decoded = await decodeVideoFrameAt(bytes, sourceTimeUs, {
          ...(signal === undefined ? {} : { signal }),
        });
        return decoded.frame;
      },
    };
    // This conformance case intentionally evaluates three independent frames at
    // once; opt into that explicit budget rather than bypassing the default cap.
    const renderer = new RenderIrFrameRenderer({ maxPendingFrames: 3 });
    try {
      const [openingFrame, transitionFrame, closingFrame] = await Promise.all([
        renderer.render({
          ir,
          timeUs: 1_000_000,
          source,
          mode: 'preview',
          preferredBackend,
        }),
        renderer.render({
          ir,
          timeUs: 15_000_000,
          source,
          mode: 'preview',
          preferredBackend,
        }),
        renderer.render({
          ir,
          timeUs: 29_000_000,
          source,
          mode: 'export',
          preferredBackend,
        }),
      ]);
      const audio = await renderIrAudio({
        ir,
        startFrame: 15 * 48_000,
        frameCount: 4_800,
        channelCount: 2,
        source: {
          pcmRange: async (assetId, streamIndex, startUs, durationUs, signal) => {
            const bytes = cache.get(assetId);
            if (bytes === undefined) throw new Error(`Unknown audio asset ${assetId}`);
            const block = await decodeAudioPcmRange(bytes, startUs, durationUs, {
              streamIndex,
              ...(signal === undefined ? {} : { signal }),
            });
            return block;
          },
        },
      });
      try {
        expect(ir.durationUs).toBe(30_000_000);
        expect(openingFrame.materialIds).toEqual(['mat_warm']);
        expect(transitionFrame.materialIds).toEqual(['mat_warm', 'mat_dissolve']);
        expect(closingFrame.materialIds).toEqual([]);
        expect(transitionFrame.backend).toBe(preferredBackend);
        expect(openingFrame.bitmap.width).toBe(320);
        expect(closingFrame.bitmap.height).toBe(180);
        expect(audio).toHaveLength(9_600);
        expect(audio.some(value => Math.abs(value) > 0.001)).toBe(true);
      } finally {
        openingFrame.bitmap.close();
        transitionFrame.bitmap.close();
        closingFrame.bitmap.close();
      }
    } finally {
      await renderer.dispose();
    }
  });
});
