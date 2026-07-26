import { describe, expect, it } from 'vitest';

import {
  ProjectMigrationError,
  RuntimeMaterialRegistry,
  installMigrationMaterials,
  migrateDiffusionCheckpoint,
  migrateWebAvProject,
  migrationMaterialPackage,
} from '../src/index.js';

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object');
  }
  return value as Readonly<Record<string, unknown>>;
}

describe('WebAV migration', () => {
  it('maps Sprite timing, z-order, transforms, animation and audio explicitly', () => {
    const result = migrateWebAvProject({
      width: 1920,
      height: 1080,
      assets: [
        {
          id: 'asset_video',
          kind: 'video',
          width: 1280,
          height: 720,
          mimeType: 'video/mp4',
        },
      ],
      sprites: [
        {
          id: 'hero',
          kind: 'video',
          assetId: 'asset_video',
          time: { offset: 2_000_000, duration: 4_000_000 },
          rect: { x: 100, y: 50, w: 960, h: 540, angle: Math.PI / 2 },
          zIndex: 7,
          opacity: 0.75,
          flip: 'horizontal',
          includeAudio: true,
          animation: [
            { timeUs: 0, x: 100, y: 50, width: 960, height: 540, opacity: 0 },
            {
              timeUs: 1_000_000,
              x: 200,
              y: 100,
              width: 480,
              height: 270,
              opacity: 1,
            },
          ],
        },
      ],
    });

    const item = result.project.items.webav_item_0;
    expect(item?.type).toBe('video');
    expect(item?.range).toEqual({ startUs: 2_000_000, durationUs: 4_000_000 });
    if (item?.type !== 'video') throw new Error('Expected migrated video Item');
    const transform = object(object(item.visual).transform);
    expect('animation' in object(transform.positionPx)).toBe(true);
    expect('animation' in object(transform.scale)).toBe(true);
    expect('animation' in object(transform.rotationDeg)).toBe(true);
    expect(result.project.items.webav_item_0_audio?.type).toBe('audio');
    expect(result.entityMap['webav:hero']).toBe('webav_item_0');
    expect(result.diagnostics).toEqual([]);
  });

  it('maps playbackRate to a linear source TimeMap instead of changing timing', () => {
    const result = migrateWebAvProject({
      width: 640,
      height: 360,
      assets: [{ id: 'audio', kind: 'audio' }],
      sprites: [
        {
          id: 'fast',
          kind: 'audio',
          assetId: 'audio',
          time: { offset: 0, duration: 1_000_000, playbackRate: 2 },
        },
      ],
    });
    const item = result.project.items.webav_item_0;
    if (item?.type !== 'audio') throw new Error('Expected migrated audio Item');
    expect(item).toMatchObject({
      source: {
        sourceRange: { durationUs: 2_000_000 },
        timeMapping: {
          type: 'linear',
          rate: { numerator: 2, denominator: 1 },
        },
      },
    });
  });

  it('does not leave a partial visual Item when includeAudio is invalid', () => {
    const result = migrateWebAvProject(
      {
        width: 640,
        height: 360,
        assets: [{ id: 'still', kind: 'image' }],
        sprites: [
          {
            id: 'invalid_still',
            kind: 'image',
            assetId: 'still',
            time: { offset: 0, duration: 1_000_000 },
            includeAudio: true,
          },
        ],
      },
      { strict: false },
    );

    expect(result.project.items).toEqual({});
    expect(result.entityMap).toEqual({});
    expect(result.diagnostics).toMatchObject([
      { code: 'WEBAV_AUDIO_STREAM_UNAVAILABLE', severity: 'error' },
    ]);
  });
});

describe('Diffusion Studio Core checkpoint migration', () => {
  it('installs executable programs for every emitted built-in transition and filter', () => {
    const registry = new RuntimeMaterialRegistry();
    const dispose = installMigrationMaterials(registry);
    expect(
      registry.resolveProgram({ ...migrationMaterialPackage, materialId: 'diffusion-dissolve' }, {})
        ?.inputPorts,
    ).toEqual(['from', 'to']);
    expect(
      registry.resolveProgram(
        { ...migrationMaterialPackage, materialId: 'diffusion-blur' },
        { value: 4, width: 1920, height: 1080 },
      )?.uniforms,
    ).toHaveLength(3);
    dispose();
    expect(
      registry.resolveProgram(
        { ...migrationMaterialPackage, materialId: 'diffusion-dissolve' },
        {},
      ),
    ).toBeUndefined();
  });

  it('maps the published v4 checkpoint field layout and adjacent Clip transitions', () => {
    const result = migrateDiffusionCheckpoint(
      {
        displayName: 'Composition',
        id: 'composition_source',
        settings: { width: 1280, height: 720, background: '#102030' },
        markers: [{ time: 0.5, name: 'beat', color: '#ff0000' }],
        layers: [
          {
            displayName: 'Layer',
            id: 'layer_top',
            clips: [
              {
                displayName: 'TextClip',
                id: 'clip_title',
                type: 'TEXT',
                delay: 0,
                duration: 2,
                text: 'Hello',
                x: 640,
                y: 80,
                width: 600,
                anchorX: 0.5,
                anchorY: 0,
                opacity: 80,
                font: { family: 'Inter', size: 64, weight: 700 },
                color: '#ffffff',
                animations: [
                  {
                    key: 'opacity',
                    frames: [
                      { time: 0, value: 0 },
                      { time: 0.5, value: 100 },
                    ],
                  },
                ],
              },
            ],
          },
          {
            displayName: 'Layer',
            id: 'layer_video',
            mode: 'SEQUENTIAL',
            clips: [
              {
                displayName: 'VideoClip',
                id: 'clip_a',
                type: 'VIDEO',
                source: 'source_a',
                delay: 0,
                duration: 1,
                range: [0, 1],
                x: 0,
                y: 0,
                width: 1280,
                height: 720,
                opacity: 100,
                effects: [{ type: 'contrast', value: 120 }],
                transition: { type: 'dissolve', duration: 0.5 },
              },
              {
                displayName: 'VideoClip',
                id: 'clip_b',
                type: 'VIDEO',
                source: 'source_b',
                delay: 1,
                duration: 1,
                range: [0, 1],
                x: 0,
                y: 0,
                width: 1280,
                height: 720,
                opacity: 100,
              },
            ],
          },
        ],
      },
      {
        assets: [
          {
            sourceId: 'source_a',
            assetId: 'asset_a',
            kind: 'video',
            width: 1280,
            height: 720,
            hasAudio: false,
          },
          {
            sourceId: 'source_b',
            assetId: 'asset_b',
            kind: 'video',
            width: 1280,
            height: 720,
            hasAudio: false,
          },
        ],
      },
    );

    expect(object(result.project.sequences.sequence_1?.format).backgroundColor).toBeDefined();
    expect(result.project.sequences.sequence_1?.trackIds).toEqual([
      'diffusion_layer_1',
      'diffusion_layer_0',
    ]);
    expect(result.project.items.diffusion_item_1000?.type).toBe('video');
    expect(result.project.items.diffusion_item_0?.type).toBe('text');
    expect(result.project.transitions.diffusion_transition_0?.range).toEqual({
      startUs: 750_000,
      durationUs: 500_000,
    });
    expect(
      result.project.materialInstances.diffusion_item_1000_effect_0?.definition.materialId,
    ).toBe('diffusion-contrast');
    expect(result.project.markers.diffusion_marker_0?.timeUs).toBe(500_000);
    expect(result.entityMap['diffusion:clip_b']).toBe('diffusion_item_1001');
  });

  it('maps rich text casing, string font weights, shape strokes, media rates and audio fades', () => {
    const result = migrateDiffusionCheckpoint(
      {
        displayName: 'Field coverage',
        settings: { width: 640, height: 360 },
        layers: [
          {
            clips: [
              {
                id: 'text',
                type: 'TEXT',
                delay: 0,
                duration: 1,
                text: 'HELLO',
                casing: 'lower',
                font: { family: 'Inter', size: 40, weight: '600', style: 'italic' },
                styles: [
                  {
                    start: 0,
                    end: 1,
                    style: {
                      casing: 'upper',
                      color: '#ff0000',
                      font: { weight: '700' },
                    },
                  },
                ],
              },
            ],
          },
          {
            clips: [
              {
                id: 'shape',
                type: 'RECT',
                delay: 0,
                duration: 1,
                width: 100,
                height: 50,
                strokes: [{ color: '#00ff00', width: 4 }],
              },
            ],
          },
          {
            clips: [
              {
                id: 'audio',
                type: 'AUDIO',
                source: 'audio_source',
                delay: 0,
                duration: 1,
                range: [0, 2],
                fadeInDurationSeconds: 0.1,
                fadeOutDurationSeconds: 0.2,
              },
            ],
          },
        ],
      },
      {
        assets: [
          {
            sourceId: 'audio_source',
            assetId: 'audio_asset',
            kind: 'audio',
          },
        ],
      },
    );

    const text = result.project.items.diffusion_item_0;
    if (text?.type !== 'text') throw new Error('Expected migrated text Item');
    expect(text).toMatchObject({
      paragraphs: [
        {
          runs: [
            {
              text: 'H',
              style: {
                fill: '#ff0000',
                fontWeight: 700,
                fontStyle: 'italic',
              },
            },
            { text: 'ello' },
          ],
        },
      ],
    });
    const shape = result.project.items.diffusion_item_1000;
    if (shape?.type !== 'shape') throw new Error('Expected migrated shape Item');
    expect(shape.shape).toMatchObject({ strokeWidthPx: 4 });
    const audio = result.project.items.diffusion_item_2000;
    if (audio?.type !== 'audio') throw new Error('Expected migrated audio Item');
    expect(audio).toMatchObject({
      source: {
        timeMapping: {
          type: 'linear',
          rate: { numerator: 2, denominator: 1 },
        },
      },
      audio: { fadeInUs: 100_000, fadeOutUs: 200_000 },
    });
  });

  it('rejects unsupported text rendering and blend fields instead of silently dropping them', () => {
    try {
      migrateDiffusionCheckpoint(
        {
          settings: { width: 640, height: 360 },
          layers: [
            {
              clips: [
                {
                  id: 'styled',
                  type: 'TEXT',
                  delay: 0,
                  duration: 1,
                  text: 'Styled',
                  background: { fill: '#000000', padding: { x: 10, y: 10 } },
                  shadows: [{ color: '#000000', blur: 8 }],
                  glow: { radius: 10 },
                  blendMode: 'xor',
                },
              ],
            },
          ],
        },
        { assets: [] },
      );
      throw new Error('Expected strict migration failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectMigrationError);
      const codes =
        error instanceof ProjectMigrationError
          ? error.diagnostics.map(diagnostic => diagnostic.code)
          : [];
      expect(codes).toEqual(
        expect.arrayContaining([
          'DIFFUSION_TEXT_BACKGROUND_UNSUPPORTED',
          'DIFFUSION_TEXT_SHADOWS_UNSUPPORTED',
          'DIFFUSION_TEXT_GLOW_UNSUPPORTED',
          'DIFFUSION_BLEND_MODE_UNSUPPORTED',
        ]),
      );
    }
  });

  it('requires CaptionSource text and reports unsupported filters in strict mode', () => {
    expect(() =>
      migrateDiffusionCheckpoint(
        {
          settings: { width: 640, height: 360 },
          layers: [
            {
              clips: [
                {
                  id: 'caption',
                  type: 'CAPTION',
                  source: 'captions',
                  delay: 0,
                  duration: 1,
                  effects: [{ type: 'url', value: '#shader' }],
                },
              ],
            },
          ],
        },
        {
          assets: [
            {
              sourceId: 'captions',
              assetId: 'caption_asset',
              kind: 'audio',
            },
          ],
        },
      ),
    ).toThrow(ProjectMigrationError);
  });
});
