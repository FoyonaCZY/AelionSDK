import type { SampleIndex } from '@aelionsdk/media';
import { describe, expect, it } from 'vitest';

import { createProject, frames, milliseconds, seconds } from '../src/project-builder.js';
import type { ProductionMediaProvider } from '../src/production-media-provider.js';

function mediaIndex(): SampleIndex {
  return {
    schemaVersion: '1.0.0',
    container: 'mp4',
    durationUs: seconds(3),
    tracks: [
      {
        kind: 'video',
        id: 1,
        codec: 'avc1.64001f',
        codecFamily: 'avc',
        codedWidth: 1920,
        codedHeight: 1080,
        rotation: 0,
        color: {
          primaries: 'bt709',
          transfer: 'bt709',
          matrix: 'bt709',
          fullRange: false,
          highDynamicRange: false,
          canBeTransparent: false,
        },
      },
      {
        kind: 'audio',
        id: 2,
        codec: 'mp4a.40.2',
        codecFamily: 'aac',
        sampleRate: 48_000,
        channelCount: 2,
      },
    ],
    capabilities: { timingAndSize: true, rawDecodeTimestamps: false, byteOffsets: false },
    samples: {},
    presentationOrder: {},
    diagnostics: [],
  };
}

describe('ProjectBuilder', () => {
  it('builds a schema-valid media project without hand-authoring Project JSON', () => {
    const builder = createProject({
      projectId: 'demo_project',
      sequenceId: 'main_sequence',
      width: 1280,
      height: 720,
      frameRate: { numerator: 30_000, denominator: 1_001 },
    });
    builder.addAsset({ id: 'asset_video', kind: 'video' });
    const trackId = builder.addTrack({ kind: 'visual', name: 'Video 1' });
    const itemId = builder.addMediaClip({
      kind: 'video',
      assetId: 'asset_video',
      trackId,
      durationUs: seconds(3),
      atUs: frames(15, { numerator: 30, denominator: 1 }),
    });
    builder.addMarker({ timeUs: milliseconds(500), label: 'Beat', itemId });

    const project = builder.build();
    expect(project.projectId).toBe('demo_project');
    expect(project.items[itemId]).toMatchObject({
      type: 'video',
      range: { startUs: 500_000, durationUs: 3_000_000 },
    });
    expect(Object.isFrozen(project)).toBe(true);
    expect(Object.isFrozen(project.items[itemId])).toBe(true);
  });

  it('probes and imports linked video/audio streams from ProductionMediaProvider', async () => {
    const index = mediaIndex();
    const provider = {
      probe: () =>
        Promise.resolve({
          assetId: 'camera',
          representationId: 'camera:original',
          role: 'original' as const,
          usedProxy: false,
          diagnostics: [],
          index,
        }),
    } satisfies Pick<ProductionMediaProvider, 'probe'>;
    const builder = createProject({ title: 'Imported clip' });
    const imported = await builder.importMedia({ provider, assetId: 'camera' });
    const project = builder.build();

    expect(imported).toMatchObject({
      assetId: 'camera',
      durationUs: 3_000_000,
    });
    expect(imported.videoTrackId).toBeTypeOf('string');
    expect(imported.audioTrackId).toBeTypeOf('string');
    expect(imported.videoItemId).toBeTypeOf('string');
    expect(imported.audioItemId).toBeTypeOf('string');
    expect(imported.linkGroupId).toBeTypeOf('string');
    expect(Object.keys(project.assets)).toEqual(['camera']);
    expect(Object.keys(project.linkGroups)).toHaveLength(1);
    expect(Object.values(project.tracks).map(track => track.kind)).toEqual(['audio', 'visual']);
  });

  it('rejects mismatched Tracks before schema validation', () => {
    const builder = createProject();
    builder.addAsset({ id: 'asset_audio', kind: 'audio' });
    const visualTrack = builder.addTrack({ kind: 'visual' });
    expect(() =>
      builder.addMediaClip({
        kind: 'audio',
        assetId: 'asset_audio',
        trackId: visualTrack,
        durationUs: seconds(1),
      }),
    ).toThrow(/audio Track/u);
  });

  it('authors the pitch-preserving linear audio policy', () => {
    const builder = createProject();
    builder.addAsset({ id: 'asset_audio', kind: 'audio' });
    const audioTrack = builder.addTrack({ kind: 'audio' });
    const itemId = builder.addMediaClip({
      kind: 'audio',
      assetId: 'asset_audio',
      trackId: audioTrack,
      durationUs: seconds(1),
      sourceDurationUs: seconds(2),
      rate: { numerator: 2, denominator: 1 },
      pitchPolicy: 'preserve',
    });
    expect(builder.build().items[itemId]).toMatchObject({
      source: { timeMapping: { type: 'linear', rate: { numerator: 2, denominator: 1 } } },
      audio: { pitchPolicy: 'preserve' },
    });
  });

  it('adds a first-class image Clip with the Project still-duration default', () => {
    const builder = createProject();
    builder.addAsset({
      id: 'asset_image',
      kind: 'image',
      mimeType: 'image/png',
    });
    const visualTrack = builder.addTrack({ kind: 'visual' });
    const itemId = builder.addImageClip({
      assetId: 'asset_image',
      trackId: visualTrack,
      fit: 'cover',
    });
    const project = builder.build();

    expect(project.items[itemId]).toMatchObject({
      type: 'image',
      range: { startUs: 0, durationUs: seconds(3) },
      source: {
        assetId: 'asset_image',
        stream: { type: 'video', index: 0 },
        timeMapping: { boundary: 'hold' },
      },
      visual: { fit: 'cover' },
    });
  });

  it('authors text, captions, shapes, effects, masks, transitions, and keyframes', () => {
    const builder = createProject({ width: 1280, height: 720 });
    const visualTrack = builder.addTrack({ kind: 'visual' });
    const captionTrack = builder.addTrack({ kind: 'caption' });
    const from = builder.addShapeClip({
      trackId: visualTrack,
      kind: 'rectangle',
      atUs: 0,
      durationUs: seconds(3),
      box: { x: 100, y: 100, width: 400, height: 240 },
      fill: '#ff0000',
    });
    const to = builder.addShapeClip({
      trackId: visualTrack,
      kind: 'ellipse',
      atUs: seconds(2),
      durationUs: seconds(3),
      box: { x: 640, y: 180, width: 320, height: 320 },
      fill: [0, 0, 1, 1],
    });
    const text = builder.addTextClip({
      trackId: visualTrack,
      text: 'Aelion',
      atUs: 0,
      durationUs: seconds(5),
      style: { fontSizePx: 64, fill: '#ffffff', align: 'center' },
    });
    const caption = builder.addCaptionClip({
      trackId: captionTrack,
      text: 'Portable caption',
      atUs: seconds(1),
      durationUs: seconds(2),
    });
    const material = builder.addMaterialInstance({
      packageId: 'dev.aelion.tests',
      packageVersion: '1.0.0',
      packageIntegrity: `sha256:${'0'.repeat(64)}`,
      materialId: 'cross-dissolve',
      parameters: { curve: 'smooth' },
    });
    const transitionMaterial = builder.addMaterialInstance({
      packageId: 'dev.aelion.tests',
      packageVersion: '1.0.0',
      packageIntegrity: `sha256:${'0'.repeat(64)}`,
      materialId: 'cross-dissolve',
      parameters: { curve: 'smooth' },
    });
    builder
      .attachEffect(text, material)
      .setMask(text, { sourceItemId: from, featherPx: 8 })
      .setKeyframes(text, 'opacity', [
        { timeUs: 0, value: 0 },
        { timeUs: seconds(1), value: 1, interpolation: 'linear' },
      ]);
    const transition = builder.addTransition({
      fromItemId: from,
      toItemId: to,
      materialInstanceId: transitionMaterial,
      atUs: seconds(2),
      durationUs: seconds(1),
    });
    const project = builder.build();

    expect(project.items[text]).toMatchObject({
      type: 'text',
      materialInstanceIds: [material],
      visual: {
        opacity: { animation: { keyframes: [{ value: 0 }, { value: 1 }] } },
        mask: { sourceItemId: from, featherPx: 8 },
      },
    });
    expect(project.items[caption]).toMatchObject({ type: 'caption' });
    expect(project.transitions[transition]).toMatchObject({
      fromItemId: from,
      toItemId: to,
      materialInstanceId: transitionMaterial,
    });
  });

  it('builds a schema-valid image-sequence clip from image frame assets', () => {
    const builder = createProject({ sequenceId: 'main', width: 320, height: 180 });
    const trackId = builder.addTrack({ kind: 'visual' });
    builder.addAsset({ id: 'frame_a', kind: 'image' });
    builder.addAsset({ id: 'frame_b', kind: 'image' });
    builder.addAsset({ id: 'frame_c', kind: 'image' });

    const itemId = builder.addImageSequenceClip({
      trackId,
      frameAssetIds: ['frame_a', 'frame_b', 'frame_c'],
      frameDurationUs: 40_000,
    });
    const project = builder.build();

    const sequenceAsset = Object.values(project.assets).find(
      asset => asset.kind === 'image-sequence',
    );
    expect(sequenceAsset).toBeDefined();
    expect(sequenceAsset?.imageSequence).toEqual({
      frameDurationUs: 40_000,
      frameAssetIds: ['frame_a', 'frame_b', 'frame_c'],
    });
    expect(project.items[itemId]).toMatchObject({
      type: 'image',
      range: { startUs: 0, durationUs: 120_000 },
    });
  });

  it('rejects an image-sequence clip referencing a missing or non-image frame', () => {
    const builder = createProject({ sequenceId: 'main', width: 320, height: 180 });
    const trackId = builder.addTrack({ kind: 'visual' });
    builder.addAsset({ id: 'frame_a', kind: 'image' });
    builder.addAsset({ id: 'asset_video', kind: 'video' });

    expect(() =>
      builder.addImageSequenceClip({
        trackId,
        frameAssetIds: ['frame_a', 'missing'],
        frameDurationUs: 40_000,
      }),
    ).toThrow(/Unknown frame Asset/);
    expect(() =>
      builder.addImageSequenceClip({
        trackId,
        frameAssetIds: ['frame_a', 'asset_video'],
        frameDurationUs: 40_000,
      }),
    ).toThrow(/must be an image Asset/);
    expect(() =>
      builder.addImageSequenceClip({ trackId, frameAssetIds: [], frameDurationUs: 40_000 }),
    ).toThrow(/at least one frame/);
  });
});
