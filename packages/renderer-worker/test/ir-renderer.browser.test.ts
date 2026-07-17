import type { JsonObject } from '@aelion/core';
import {
  compileMaterialGraphToWebGl2,
  type MaterialGraph,
  type WebGl2MaterialProgram,
} from '@aelion/material-compiler';
import type { AelionProject, ItemEntity } from '@aelion/project-schema';
import { IncrementalRenderCompiler, type IrMaterialDefinition } from '@aelion/render-ir';
import { describe, expect, it } from 'vitest';

import { RenderIrFrameRenderer, type IrFrameSource } from '../src/index.js';

const crossDissolveGraph: MaterialGraph = {
  $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
  graphVersion: '1.0.0',
  nodeSet: 'aelion.visual.nodes/1.0.0',
  nodes: [
    {
      id: 'eased',
      type: 'time.transition-curve',
      typeVersion: '1.0.0',
      inputs: {
        progress: { system: 'transitionProgress' },
        curve: { parameter: 'curve' },
      },
    },
    {
      id: 'mix',
      type: 'composite.mix',
      typeVersion: '1.0.0',
      inputs: {
        a: { inputPort: 'from' },
        b: { inputPort: 'to' },
        amount: { node: 'eased', output: 'value' },
      },
    },
  ],
  outputs: { result: { node: 'mix', output: 'frame' } },
};

const warmFilmGraph: MaterialGraph = {
  $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
  graphVersion: '1.0.0',
  nodeSet: 'aelion.visual.nodes/1.0.0',
  nodes: [
    {
      id: 'warm',
      type: 'color.temperature',
      typeVersion: '1.0.0',
      inputs: { source: { inputPort: 'source' }, amount: { value: 0.2 } },
    },
    {
      id: 'mix',
      type: 'composite.mix',
      typeVersion: '1.0.0',
      inputs: {
        a: { inputPort: 'source' },
        b: { node: 'warm', output: 'frame' },
        amount: { parameter: 'intensity' },
      },
    },
  ],
  outputs: { result: { node: 'mix', output: 'frame' } },
};

function project(): AelionProject {
  return {
    $schema: 'https://schemas.aelion.dev/project/v1.json',
    schemaVersion: '1.0.0',
    projectId: 'vertical_slice',
    metadata: {},
    settings: {
      defaultSequenceId: 'sequence',
      defaultStillDurationUs: 3_000_000,
      missingAssetPolicy: 'error',
      missingMaterialPolicy: 'error',
      missingPluginPolicy: 'error',
    },
    assets: {
      red: { id: 'red', kind: 'video', locator: { type: 'runtime-binding', bindingId: 'red' } },
      blue: {
        id: 'blue',
        kind: 'video',
        locator: { type: 'runtime-binding', bindingId: 'blue' },
      },
    },
    sequences: {
      sequence: {
        id: 'sequence',
        format: {
          width: 8,
          height: 8,
          pixelAspectRatio: { numerator: 1, denominator: 1 },
          frameRate: { numerator: 30, denominator: 1 },
          sampleRate: 48_000,
          channelLayout: 'stereo',
          workingColorSpace: 'srgb-linear',
          backgroundColor: { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
        },
        duration: { mode: 'fixed', durationUs: 30_000_000, overflow: 'clip' },
        trackIds: ['visual'],
        transitionIds: ['transition'],
        materialInstanceIds: [],
        markerIds: [],
      },
    },
    tracks: {
      visual: {
        id: 'visual',
        sequenceId: 'sequence',
        kind: 'visual',
        enabled: true,
        locked: false,
        itemIds: ['from', 'to'],
        materialInstanceIds: [],
      },
    },
    items: {
      from: mediaItem('from', 'red', 0),
      to: mediaItem('to', 'blue', 14_000_000),
    },
    materialInstances: {
      warm: {
        id: 'warm',
        definition: materialDefinition('warm-film'),
        enabled: true,
        parameters: { intensity: 1 },
      },
      dissolve: {
        id: 'dissolve',
        definition: materialDefinition('cross-dissolve'),
        enabled: true,
        parameters: { curve: 'linear' },
      },
    },
    transitions: {
      transition: {
        id: 'transition',
        sequenceId: 'sequence',
        trackId: 'visual',
        fromItemId: 'from',
        toItemId: 'to',
        range: { startUs: 14_000_000, durationUs: 2_000_000 },
        materialInstanceId: 'dissolve',
      },
    },
    markers: {},
    linkGroups: {},
    extensions: {},
  } as unknown as AelionProject;
}

function materialDefinition(materialId: string): JsonObject {
  return {
    packageId: 'dev.aelion.vertical-slice',
    packageVersion: '1.0.0',
    packageIntegrity: `sha256:${'0'.repeat(64)}`,
    materialId,
  };
}

function mediaItem(id: string, assetId: string, startUs: number): ItemEntity {
  return {
    id,
    trackId: 'visual',
    type: 'video',
    enabled: true,
    range: { startUs, durationUs: 16_000_000 },
    source: {
      assetId,
      stream: { type: 'video', index: 0 },
      sourceRange: { startUs: 0, durationUs: 16_000_000 },
      timeMapping: {
        type: 'linear',
        rate: { numerator: 1, denominator: 1 },
        reverse: false,
        boundary: 'error',
      },
    },
    visual: {
      fit: 'fill',
      transform: {
        positionPx: { x: 4, y: 4 },
        anchor: { x: 0.5, y: 0.5 },
        scale: { x: 1, y: 1 },
        rotationDeg: 0,
        skewDeg: { x: 0, y: 0 },
      },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      opacity: 1,
      blendMode: 'normal',
    },
    materialInstanceIds: id === 'from' ? ['warm'] : [],
  } as ItemEntity;
}

function program(definition: IrMaterialDefinition): WebGl2MaterialProgram | undefined {
  if (definition.materialId === 'warm-film') {
    return compileMaterialGraphToWebGl2(warmFilmGraph, {
      parameters: { intensity: 'float' },
      inputPorts: { source: 'visual-frame' },
    });
  }
  if (definition.materialId === 'cross-dissolve') {
    return compileMaterialGraphToWebGl2(crossDissolveGraph, {
      parameters: { curve: 'enum' },
      specializationValues: { curve: 'linear' },
      inputPorts: { from: 'visual-frame', to: 'visual-frame' },
      systems: { transitionProgress: 'float' },
    });
  }
  return undefined;
}

function pixel(bitmap: ImageBitmap): readonly number[] {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(4, 4, 1, 1).data];
}

function pixelOver(bitmap: ImageBitmap, fillStyle: string): readonly number[] {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('2D context unavailable');
  context.fillStyle = fillStyle;
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(4, 4, 1, 1).data];
}

function expectFrameClosed(frame: VideoFrame): void {
  expect(frame.format).toBeNull();
  expect(frame.codedWidth).toBe(0);
  expect(frame.codedHeight).toBe(0);
}

const source: IrFrameSource = {
  frameAt: assetId => {
    const canvas = new OffscreenCanvas(8, 8);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D context unavailable');
    context.fillStyle = assetId === 'red' ? 'rgb(200 0 0)' : 'rgb(0 0 200)';
    context.fillRect(0, 0, 8, 8);
    return Promise.resolve(new VideoFrame(canvas, { timestamp: 0 }));
  },
};

describe('Project → Render IR → Material Graph → Worker renderer', () => {
  it('rasterizes explicit text spacing through the portable glyph layout', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const visual = value.tracks.visual;
    if (sequence === undefined || visual === undefined) throw new Error('Fixture is incomplete');
    const format = sequence.format as { width: number; height: number };
    format.width = 160;
    format.height = 60;
    sequence.transitionIds = [];
    visual.itemIds = ['title'];
    value.items = {
      title: {
        id: 'title',
        trackId: 'visual',
        type: 'text',
        enabled: true,
        range: { startUs: 0, durationUs: 1_000_000 },
        box: { x: 10, y: 10, width: 140, height: 40 },
        overflow: 'clip',
        writingMode: 'horizontal-tb',
        paragraphs: [
          {
            style: {},
            runs: [
              {
                text: 'A  A',
                style: { fontSizePx: 24, lineHeightPx: 28, fill: '#ffffff' },
              },
            ],
          },
        ],
        visual: {
          fit: 'none',
          transform: {
            positionPx: { x: 80, y: 30 },
            anchor: { x: 0.5, y: 0.5 },
            scale: { x: 1, y: 1 },
            rotationDeg: 0,
            skewDeg: { x: 0, y: 0 },
          },
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
          opacity: 1,
          blendMode: 'normal',
        },
        materialInstanceIds: [],
      } as unknown as ItemEntity,
    };
    value.materialInstances = {};
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    const renderer = new RenderIrFrameRenderer();
    try {
      const result = await renderer.render({
        ir,
        timeUs: 0,
        source,
        mode: 'preview',
        preferredBackend: 'webgl2',
      });
      try {
        const canvas = new OffscreenCanvas(result.width, result.height);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2D context unavailable');
        context.drawImage(result.bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, result.width, result.height).data;
        const occupied: number[] = [];
        for (let x = 0; x < result.width; x += 1) {
          let bright = false;
          for (let y = 0; y < result.height; y += 1) {
            const index = (y * result.width + x) * 4;
            if ((pixels[index] ?? 0) > 32) {
              bright = true;
              break;
            }
          }
          if (bright) occupied.push(x);
        }
        const gaps = occupied.slice(1).map((x, index) => x - (occupied[index] ?? x));
        expect(occupied.length).toBeGreaterThan(10);
        expect(Math.max(...gaps)).toBeGreaterThan(12);
      } finally {
        result.bitmap.close();
      }
    } finally {
      await renderer.dispose();
    }
  });

  it('renders draft previews internally at scale while keeping export full resolution', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const visual = value.tracks.visual;
    if (sequence === undefined || visual === undefined) throw new Error('Fixture is incomplete');
    sequence.transitionIds = [];
    visual.itemIds = ['from'];
    value.items.from?.materialInstanceIds.splice(0);
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    const renderer = new RenderIrFrameRenderer();
    try {
      const draft = await renderer.render({
        ir,
        timeUs: 1_000_000,
        source,
        mode: 'preview',
        renderScale: 0.5,
        preferredBackend: 'webgl2',
      });
      const exported = await renderer.render({
        ir,
        timeUs: 1_000_000,
        source,
        mode: 'export',
        renderScale: 0.5,
        preferredBackend: 'webgl2',
      });
      try {
        expect(draft).toMatchObject({ width: 4, height: 4, renderScale: 0.5 });
        expect(draft.bitmap).toMatchObject({ width: 4, height: 4 });
        expect(exported).toMatchObject({ width: 8, height: 8, renderScale: 1 });
      } finally {
        draft.bitmap.close();
        exported.bitmap.close();
      }
      await expect(
        renderer.render({
          ir,
          timeUs: 1_000_000,
          source,
          mode: 'preview',
          renderScale: 0,
          preferredBackend: 'webgl2',
        }),
      ).rejects.toThrow('renderScale');
    } finally {
      await renderer.dispose();
    }
  });

  it('bounds full frame evaluations before media decode starts', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const visual = value.tracks.visual;
    if (sequence === undefined || visual === undefined) throw new Error('Fixture is incomplete');
    sequence.transitionIds = [];
    visual.itemIds = ['from'];
    value.items.from?.materialInstanceIds.splice(0);
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    let release: ((frame: VideoFrame) => void) | undefined;
    let decodeCalls = 0;
    const blockedSource: IrFrameSource = {
      frameAt: () => {
        decodeCalls += 1;
        return new Promise(resolve => {
          release = resolve;
        });
      },
    };
    const renderer = new RenderIrFrameRenderer({ maxPendingFrames: 1 });
    const first = renderer.render({
      ir,
      timeUs: 1_000_000,
      source: blockedSource,
      mode: 'preview',
      preferredBackend: 'webgl2',
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await expect(
      renderer.render({
        ir,
        timeUs: 1_000_000,
        source: blockedSource,
        mode: 'preview',
        preferredBackend: 'webgl2',
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'RENDERER_FRAME_QUEUE_FULL' })],
    });
    expect(decodeCalls).toBe(1);
    expect(renderer.snapshot()).toMatchObject({ pendingFrames: 1, maxPendingFrames: 1 });
    const canvas = new OffscreenCanvas(8, 8);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D context unavailable');
    context.fillStyle = 'rgb(200 0 0)';
    context.fillRect(0, 0, 8, 8);
    release?.(new VideoFrame(canvas, { timestamp: 0 }));
    const result = await first;
    result.bitmap.close();
    expect(renderer.snapshot().pendingFrames).toBe(0);
    await renderer.dispose();
    expect(renderer.snapshot()).toMatchObject({ disposed: true, pendingFrames: 0 });
    expect(() => new RenderIrFrameRenderer({ maxPendingFrames: 0 })).toThrow('maxPendingFrames');
  });

  it('aborts an in-flight media request when the renderer is disposed', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const visual = value.tracks.visual;
    if (sequence === undefined || visual === undefined) throw new Error('Fixture is incomplete');
    sequence.transitionIds = [];
    visual.itemIds = ['from'];
    value.items.from?.materialInstanceIds.splice(0);
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    let observedSignal: AbortSignal | undefined;
    let rejectMedia: ((error: Error) => void) | undefined;
    const renderer = new RenderIrFrameRenderer({ maxPendingFrames: 1 });
    const pending = renderer.render({
      ir,
      timeUs: 1_000_000,
      source: {
        frameAt: (_assetId, _streamIndex, _sourceTimeUs, signal) => {
          observedSignal = signal;
          return new Promise((_resolve, reject) => {
            rejectMedia = reject;
            signal?.addEventListener('abort', () => undefined, { once: true });
          });
        },
      },
      mode: 'preview',
      preferredBackend: 'webgl2',
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    let disposeSettled = false;
    const dispose = renderer.dispose().then(() => {
      disposeSettled = true;
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    expect(disposeSettled).toBe(false);
    expect(observedSignal?.aborted).toBe(true);
    rejectMedia?.(new DOMException('Media request aborted', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await dispose;
    expect(disposeSettled).toBe(true);
    expect(renderer.snapshot()).toMatchObject({ disposed: true, pendingFrames: 0 });
  });

  it('closes a decoded frame when Material validation fails before Worker transfer', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const visual = value.tracks.visual;
    const from = value.items.from;
    if (sequence === undefined || visual === undefined || from === undefined) {
      throw new Error('Fixture is incomplete');
    }
    sequence.transitionIds = [];
    visual.itemIds = ['from'];
    from.materialInstanceIds = ['warm'];
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    let decoded: VideoFrame | undefined;
    const renderer = new RenderIrFrameRenderer();

    try {
      await expect(
        renderer.render({
          ir,
          timeUs: 1_000_000,
          source: {
            frameAt: () => {
              const canvas = new OffscreenCanvas(8, 8);
              const context = canvas.getContext('2d');
              if (context === null) throw new Error('2D context unavailable');
              context.fillStyle = 'black';
              context.fillRect(0, 0, 8, 8);
              decoded = new VideoFrame(canvas, { timestamp: 0 });
              return Promise.resolve(decoded);
            },
          },
          mode: 'export',
          preferredBackend: 'webgl2',
        }),
      ).rejects.toThrow('has no executable backend');
      if (decoded === undefined) throw new Error('The test source did not produce a frame');
      expectFrameClosed(decoded);
    } finally {
      await renderer.dispose();
    }
  });

  it('closes a decoded frame returned after Renderer disposal', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const visual = value.tracks.visual;
    if (sequence === undefined || visual === undefined) throw new Error('Fixture is incomplete');
    sequence.transitionIds = [];
    visual.itemIds = ['from'];
    value.items.from?.materialInstanceIds.splice(0);
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    let resolveFrame: (() => void) | undefined;
    let decoded: VideoFrame | undefined;
    const frameGate = new Promise<VideoFrame>(resolve => {
      const canvas = new OffscreenCanvas(8, 8);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('2D context unavailable');
      context.fillStyle = 'black';
      context.fillRect(0, 0, 8, 8);
      resolveFrame = () => {
        decoded = new VideoFrame(canvas, { timestamp: 0 });
        resolve(decoded);
      };
    });
    const renderer = new RenderIrFrameRenderer();
    const pending = renderer.render({
      ir,
      timeUs: 1_000_000,
      source: { frameAt: () => frameGate },
      mode: 'preview',
      preferredBackend: 'webgl2',
    });

    const disposal = renderer.dispose();
    resolveFrame?.();
    await expect(pending).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
    await disposal;
    if (decoded === undefined) throw new Error('The test source did not produce a frame');
    expectFrameClosed(decoded);
    expect(renderer.snapshot()).toMatchObject({ disposed: true, pendingFrames: 0 });
  });

  it('uses the same frozen IR frame evaluator for preview and export', async () => {
    const ir = new IncrementalRenderCompiler().compile(project(), 'sequence', 0n, {
      resolveMaterialProgram: definition => program(definition),
    }).ir;
    const renderer = new RenderIrFrameRenderer();
    try {
      const preview = await renderer.render({
        ir,
        timeUs: 15_000_000,
        source,
        mode: 'preview',
        preferredBackend: 'webgl2',
      });
      const exported = await renderer.render({
        ir,
        timeUs: 15_000_000,
        source,
        mode: 'export',
        preferredBackend: 'webgl2',
      });
      try {
        const previewPixel = pixel(preview.bitmap);
        const exportPixel = pixel(exported.bitmap);
        expect(previewPixel).toEqual(exportPixel);
        expect(previewPixel[0]).toBeGreaterThan(previewPixel[2] ?? 0);
        expect(preview.materialIds).toEqual(['warm', 'dissolve']);
        expect(exported.materialIds).toEqual(preview.materialIds);
      } finally {
        preview.bitmap.close();
        exported.bitmap.close();
      }
    } finally {
      await renderer.dispose();
    }
  });

  it('applies base visual opacity from Render IR before Material execution', async () => {
    const value = project();
    const item = value.items.from;
    if (item === undefined) throw new Error('Fixture clip is missing');
    const visual = item.visual;
    if (visual === null || Array.isArray(visual) || typeof visual !== 'object') {
      throw new Error('Fixture visual properties are missing');
    }
    visual.opacity = 0.5;
    item.materialInstanceIds = [];
    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n, {
      resolveMaterialProgram: definition => program(definition),
    }).ir;
    const renderer = new RenderIrFrameRenderer();
    const result = await renderer.render({
      ir,
      timeUs: 1_000_000,
      source,
      mode: 'preview',
      preferredBackend: 'webgl2',
    });
    try {
      // Project backgroundColor is now an explicit base layer. The half-opacity
      // red clip is therefore flattened over the authored opaque black canvas.
      const overBlack = pixelOver(result.bitmap, 'black');
      expect(overBlack[0]).toBeGreaterThanOrEqual(99);
      expect(overBlack[0]).toBeLessThanOrEqual(101);
      expect(overBlack[1]).toBeLessThanOrEqual(1);
      expect(overBlack[2]).toBeLessThanOrEqual(1);
      expect(overBlack[3]).toBe(255);

      const overWhite = pixelOver(result.bitmap, 'white');
      expect(overWhite[0]).toBeGreaterThanOrEqual(99);
      expect(overWhite[0]).toBeLessThanOrEqual(101);
      expect(overWhite[1]).toBeLessThanOrEqual(1);
      expect(overWhite[2]).toBeLessThanOrEqual(1);
      expect(overWhite[3]).toBe(255);
    } finally {
      result.bitmap.close();
      await renderer.dispose();
    }
  });

  it('alpha-composites every enabled visual track in Project order', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const baseTrack = value.tracks.visual;
    const baseItem = value.items.from;
    if (sequence === undefined || baseTrack === undefined || baseItem === undefined) {
      throw new Error('Multi-track fixture base entities are missing');
    }
    sequence.trackIds = ['visual', 'overlay'];
    sequence.transitionIds = [];
    baseTrack.itemIds = ['from'];
    value.tracks.overlay = {
      id: 'overlay',
      sequenceId: 'sequence',
      kind: 'visual',
      enabled: true,
      locked: false,
      itemIds: ['overlay-item'],
      materialInstanceIds: [],
    };
    const overlay = mediaItem('overlay-item', 'blue', 0);
    overlay.trackId = 'overlay';
    const visual = overlay.visual;
    if (visual === null || Array.isArray(visual) || typeof visual !== 'object') {
      throw new Error('Overlay visual properties are missing');
    }
    visual.opacity = 0.5;
    overlay.materialInstanceIds = [];
    value.items['overlay-item'] = overlay;
    baseItem.materialInstanceIds = [];

    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
    const renderer = new RenderIrFrameRenderer();
    const result = await renderer.render({
      ir,
      timeUs: 1_000_000,
      source,
      mode: 'preview',
      preferredBackend: 'webgl2',
    });
    try {
      const actual = pixel(result.bitmap);
      expect(actual[0]).toBeGreaterThanOrEqual(98);
      expect(actual[0]).toBeLessThanOrEqual(102);
      expect(actual[2]).toBeGreaterThanOrEqual(98);
      expect(actual[2]).toBeLessThanOrEqual(102);
      expect(actual[3]).toBeGreaterThanOrEqual(254);
    } finally {
      result.bitmap.close();
      await renderer.dispose();
    }
  });

  it('keeps a transition result in the layer stack before compositing later visual tracks', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    if (sequence === undefined) throw new Error('Transition fixture Sequence is missing');
    sequence.trackIds = ['visual', 'overlay'];
    value.tracks.overlay = {
      id: 'overlay',
      sequenceId: 'sequence',
      kind: 'visual',
      enabled: true,
      locked: false,
      itemIds: ['overlay-item'],
      materialInstanceIds: [],
    };
    const overlay = mediaItem('overlay-item', 'blue', 0);
    overlay.trackId = 'overlay';
    overlay.materialInstanceIds = [];
    const visual = overlay.visual;
    if (visual === null || Array.isArray(visual) || typeof visual !== 'object') {
      throw new Error('Overlay visual properties are missing');
    }
    visual.opacity = 0.5;
    value.items['overlay-item'] = overlay;

    const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n, {
      resolveMaterialProgram: definition => program(definition),
    }).ir;
    const renderer = new RenderIrFrameRenderer();
    try {
      const preview = await renderer.render({
        ir,
        timeUs: 15_000_000,
        source,
        mode: 'preview',
        preferredBackend: 'webgl2',
      });
      const exported = await renderer.render({
        ir,
        timeUs: 15_000_000,
        source,
        mode: 'export',
        preferredBackend: 'webgl2',
      });
      try {
        const previewPixel = pixel(preview.bitmap);
        expect(pixel(exported.bitmap)).toEqual(previewPixel);
        expect(previewPixel[2]).toBeGreaterThan(previewPixel[0] ?? 255);
        expect(previewPixel[3]).toBeGreaterThanOrEqual(254);
        expect(preview.materialIds).toEqual(['warm', 'dissolve']);
        expect(exported.materialIds).toEqual(preview.materialIds);
      } finally {
        preview.bitmap.close();
        exported.bitmap.close();
      }
    } finally {
      await renderer.dispose();
    }
  });

  it('applies alpha masks with invert, feather and consumed matte semantics', async () => {
    const renderMasked = async (invert: boolean): Promise<readonly number[]> => {
      const value = project();
      const sequence = value.sequences.sequence;
      const track = value.tracks.visual;
      const from = value.items.from;
      const to = value.items.to;
      if (sequence === undefined || track === undefined || from === undefined || to === undefined) {
        throw new Error('Fixture is incomplete');
      }
      sequence.transitionIds = [];
      track.itemIds = ['to', 'from'];
      to.range = { ...to.range, startUs: 0 };
      from.materialInstanceIds = [];
      const visual = from.visual as JsonObject;
      visual.mask = {
        sourceItemId: 'to',
        channel: 'alpha',
        invert,
        featherPx: 2,
        space: 'canvas',
        consumeSource: true,
      };
      const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
      const renderer = new RenderIrFrameRenderer();
      const result = await renderer.render({
        ir,
        timeUs: 1_000_000,
        source,
        mode: 'preview',
        preferredBackend: 'webgl2',
      });
      try {
        return pixel(result.bitmap);
      } finally {
        result.bitmap.close();
        await renderer.dispose();
      }
    };
    expect(await renderMasked(false)).toEqual([200, 0, 0, 255]);
    expect(await renderMasked(true)).toEqual([0, 0, 0, 255]);
  });

  it('renders a gradient Generator without invoking the media provider', async () => {
    const value = project();
    const sequence = value.sequences.sequence;
    const track = value.tracks.visual;
    const from = value.items.from;
    if (sequence === undefined || track === undefined || from === undefined) {
      throw new Error('Fixture is incomplete');
    }
    sequence.transitionIds = [];
    track.itemIds = ['generator'];
    value.items.generator = {
      id: 'generator',
      trackId: 'visual',
      type: 'generator',
      enabled: true,
      range: { startUs: 0, durationUs: 2_000_000 },
      generator: {
        kind: 'linear-gradient',
        colors: [
          { space: 'srgb-linear', rgba: [0, 1, 0, 1] },
          { space: 'srgb-linear', rgba: [0, 0, 1, 1] },
        ],
        angleDeg: 0,
      },
      visual: structuredClone(from.visual),
      materialInstanceIds: [],
    } as ItemEntity;
    let mediaCalls = 0;
    const renderer = new RenderIrFrameRenderer();
    const result = await renderer.render({
      ir: new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir,
      timeUs: 1_000_000,
      source: {
        frameAt: () => {
          mediaCalls++;
          return Promise.reject(new Error('Generator must not decode media'));
        },
      },
      mode: 'preview',
      preferredBackend: 'webgl2',
    });
    try {
      expect(mediaCalls).toBe(0);
      const center = pixel(result.bitmap);
      expect(center[1]).toBeGreaterThan(100);
      expect(center[2]).toBeGreaterThan(100);
    } finally {
      result.bitmap.close();
      await renderer.dispose();
    }
  });

  it('executes every Project blend mode consistently across WebGL2 and WebGPU', async () => {
    const modes = [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
    ] as const;
    const renderer = new RenderIrFrameRenderer();
    try {
      for (const mode of modes) {
        const value = project();
        const sequence = value.sequences.sequence;
        const track = value.tracks.visual;
        const from = value.items.from;
        const to = value.items.to;
        if (
          sequence === undefined ||
          track === undefined ||
          from === undefined ||
          to === undefined
        ) {
          throw new Error('Fixture is incomplete');
        }
        sequence.transitionIds = [];
        track.itemIds = ['from', 'to'];
        to.range = { ...to.range, startUs: 0 };
        from.materialInstanceIds = [];
        (to.visual as JsonObject).blendMode = mode;
        const ir = new IncrementalRenderCompiler().compile(value, 'sequence', 0n).ir;
        const webgl = await renderer.render({
          ir,
          timeUs: 1_000_000,
          source,
          mode: 'preview',
          preferredBackend: 'webgl2',
          allowFallback: false,
        });
        const gpu = await renderer.render({
          ir,
          timeUs: 1_000_000,
          source,
          mode: 'preview',
          preferredBackend: 'webgpu',
          allowFallback: true,
        });
        try {
          const left = pixel(webgl.bitmap);
          const right = pixel(gpu.bitmap);
          if (gpu.backend === 'webgpu') {
            expect(
              Math.max(...left.map((value, index) => Math.abs(value - (right[index] ?? 0)))),
              mode,
            ).toBeLessThanOrEqual(2);
          }
          expect(left[3], mode).toBe(255);
        } finally {
          webgl.bitmap.close();
          gpu.bitmap.close();
        }
      }
    } finally {
      await renderer.dispose();
    }
  });
});
