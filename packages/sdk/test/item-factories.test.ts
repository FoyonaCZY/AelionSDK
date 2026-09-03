import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@aelionsdk/core';
import {
  ProjectValidator,
  snapshotProjectInput,
  type AelionProject,
  type ColorValue,
} from '@aelionsdk/project-schema';

import {
  createAdjustmentItem,
  createAudioItem,
  createCaptionItem,
  createGapItem,
  createGeneratorItem,
  createImageItem,
  createShapeItem,
  createTextItem,
  createTrack,
  createVideoItem,
  defaultVisual,
  linearTimeMapping,
} from '../src/item-factories.js';

/**
 * Puts every factory's output through the validator that will actually see it.
 *
 * These exist so a host does not hand-write schema literals and discover a
 * missing field at commit time. That promise is only kept if the factories are
 * checked against the shipped schema rather than against the TypeScript types,
 * which are deliberately looser: `TextRun.style` is optional in the interface
 * and required by the document, so a factory can typecheck and still produce an
 * Item no Project will accept.
 */

const root = new URL('../../../', import.meta.url);
const read = (path: string): JsonObject =>
  JSON.parse(readFileSync(new URL(path, root), 'utf8')) as JsonObject;

const projectSchema = read('schemas/project/v2.0/project.schema.json');
const materialInstanceSchema = read('schemas/material/v1/instance.schema.json');
const validator = new ProjectValidator({ projectSchema, materialInstanceSchema });

const FRAME = { width: 1920, height: 1080 } as const;
const BASE = { atUs: 0, durationUs: 4_000_000 } as const;

/** A Project holding exactly the given entities, so the Item is what is judged. */
function projectWith(tracks: JsonObject[], items: JsonObject[]): AelionProject {
  const byTrack = new Map<string, string[]>();
  for (const track of tracks) byTrack.set(track.id as string, []);
  for (const item of items) {
    byTrack.get(item.trackId as string)?.push(item.id as string);
  }
  return {
    $schema: 'https://schemas.aelion.dev/project/v2.0.json',
    schemaVersion: '2.0.0',
    projectId: 'proj_factories',
    metadata: {},
    settings: {
      defaultSequenceId: 'seq_main',
      defaultStillDurationUs: 5_000_000,
      missingAssetPolicy: 'error',
      missingMaterialPolicy: 'error',
      missingPluginPolicy: 'error',
    },
    assets: {
      asset_a: {
        id: 'asset_a',
        kind: 'video',
        locator: { type: 'runtime-binding', bindingId: 'asset_a' },
      },
    },
    sequences: {
      seq_main: {
        id: 'seq_main',
        format: {
          width: FRAME.width,
          height: FRAME.height,
          pixelAspectRatio: { numerator: 1, denominator: 1 },
          frameRate: { numerator: 30, denominator: 1 },
          sampleRate: 48_000,
          channelLayout: 'stereo',
          workingColorSpace: 'srgb-linear',
          backgroundColor: { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
        },
        duration: { mode: 'content' },
        trackIds: tracks.map(track => track.id as string),
        transitionIds: [],
        materialInstanceIds: [],
        markerIds: [],
      },
    },
    tracks: Object.fromEntries(
      tracks.map(track => [
        track.id as string,
        { ...track, itemIds: byTrack.get(track.id as string) ?? [] },
      ]),
    ),
    items: Object.fromEntries(items.map(item => [item.id as string, item])),
    materialInstances: {},
    transitions: {},
    markers: {},
    linkGroups: {},
    extensions: {},
  } as unknown as AelionProject;
}

const visualTrack = createTrack({
  id: 'track_v1',
  sequenceId: 'seq_main',
  kind: 'visual',
}) as unknown as JsonObject;
const audioTrack = createTrack({
  id: 'track_a1',
  sequenceId: 'seq_main',
  kind: 'audio',
}) as unknown as JsonObject;
const captionTrack = createTrack({
  id: 'track_c1',
  sequenceId: 'seq_main',
  kind: 'caption',
}) as unknown as JsonObject;

function expectValid(track: JsonObject, item: JsonObject): void {
  const result = validator.validate(projectWith([track], [item]));
  if (!result.ok) {
    throw new Error(
      `${JSON.stringify(item.type)} Item was rejected: ${result.diagnostics
        .slice(0, 3)
        .map(entry => `${entry.code} at ${(entry.path ?? []).join('/')}: ${entry.message}`)
        .join(' | ')}`,
    );
  }
  expect(result.ok).toBe(true);
}

describe('Item factories produce documents the validator accepts', () => {
  it('createVideoItem', () => {
    expectValid(
      visualTrack,
      createVideoItem({
        ...BASE,
        id: 'item_v',
        trackId: 'track_v1',
        assetId: 'asset_a',
        frame: FRAME,
      }) as unknown as JsonObject,
    );
  });

  it('createImageItem', () => {
    expectValid(
      visualTrack,
      createImageItem({
        ...BASE,
        id: 'item_i',
        trackId: 'track_v1',
        assetId: 'asset_a',
        frame: FRAME,
      }) as unknown as JsonObject,
    );
  });

  it('createAudioItem', () => {
    expectValid(
      audioTrack,
      createAudioItem({
        ...BASE,
        id: 'item_a',
        trackId: 'track_a1',
        assetId: 'asset_a',
        fadeInUs: 100_000,
        fadeOutUs: 100_000,
        pitchPolicy: 'preserve',
      }) as unknown as JsonObject,
    );
  });

  it('createTextItem with only the text supplied', () => {
    expectValid(
      visualTrack,
      createTextItem({
        ...BASE,
        id: 'item_t',
        trackId: 'track_v1',
        frame: FRAME,
        box: { x: 160, y: 780, width: 1600, height: 200 },
        paragraphs: [{ runs: [{ text: 'Hello' }] }],
      }) as unknown as JsonObject,
    );
  });

  it('createTextItem with styles supplied', () => {
    expectValid(
      visualTrack,
      createTextItem({
        ...BASE,
        id: 'item_t2',
        trackId: 'track_v1',
        frame: FRAME,
        box: { x: 0, y: 0, width: 100, height: 50 },
        overflow: 'clip',
        writingMode: 'vertical-rl',
        paragraphs: [
          {
            style: { align: 'center' },
            runs: [{ text: 'Styled', style: { fontSizePx: 48 } }],
          },
        ],
      }) as unknown as JsonObject,
    );
  });

  it('createCaptionItem', () => {
    expectValid(
      captionTrack,
      createCaptionItem({
        ...BASE,
        id: 'item_c',
        trackId: 'track_c1',
        frame: FRAME,
        text: 'Subtitle line',
        box: { x: 0, y: 900, width: 1920, height: 120 },
        style: { fontSizePx: 40 },
        overflow: 'clip',
      }) as unknown as JsonObject,
    );
  });

  it('createShapeItem', () => {
    expectValid(
      visualTrack,
      createShapeItem({
        ...BASE,
        id: 'item_s',
        trackId: 'track_v1',
        frame: FRAME,
        shape: {
          kind: 'rectangle',
          box: { x: 0, y: 0, width: 200, height: 100 },
          fill: { space: 'srgb-linear', rgba: [1, 0, 0, 1] },
        },
      }) as unknown as JsonObject,
    );
  });

  it('createGeneratorItem', () => {
    expectValid(
      visualTrack,
      createGeneratorItem({
        ...BASE,
        id: 'item_g',
        trackId: 'track_v1',
        frame: FRAME,
        kind: 'linear-gradient',
        colors: [
          { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
          { space: 'srgb-linear', rgba: [1, 1, 1, 1] },
        ],
        angleDeg: 45,
      }) as unknown as JsonObject,
    );
  });

  it('createAdjustmentItem', () => {
    expectValid(
      visualTrack,
      createAdjustmentItem({
        ...BASE,
        id: 'item_adj',
        trackId: 'track_v1',
        frame: FRAME,
      }) as unknown as JsonObject,
    );
  });

  it('createGapItem', () => {
    expectValid(
      visualTrack,
      createGapItem({ ...BASE, id: 'item_gap', trackId: 'track_v1' }) as unknown as JsonObject,
    );
  });

  it('accepts every optional field a factory exposes', () => {
    expectValid(
      visualTrack,
      createVideoItem({
        ...BASE,
        id: 'item_full',
        trackId: 'track_v1',
        assetId: 'asset_a',
        frame: FRAME,
        name: 'Named clip',
        enabled: false,
        metadata: { note: 'kept' },
        fit: 'fill',
        opacity: 0.5,
        sourceStartUs: 1_000_000,
        sourceDurationUs: 2_000_000,
        streamIndex: 1,
        timeMapping: linearTimeMapping({ rate: { numerator: 2, denominator: 1 }, reverse: true }),
      }) as unknown as JsonObject,
    );
  });
});

describe('a factory hands back an entity it owns', () => {
  it('survives a reused object inside one Item', () => {
    // A host that keeps one palette entry and uses it at both ends of a
    // gradient. Stored by reference this is the same object twice, which
    // transaction admission rejects as a shared object.
    const red: ColorValue = { space: 'srgb-linear', rgba: [1, 0, 0, 1] };
    const item = createGeneratorItem({
      ...BASE,
      id: 'item_g',
      trackId: 'track_v1',
      frame: FRAME,
      kind: 'linear-gradient',
      colors: [red, red],
    }) as unknown as JsonObject;
    expect(() => snapshotProjectInput(item)).not.toThrow();
    expectValid(visualTrack, item);
  });

  it('survives a reused point inside one shape', () => {
    const origin = { x: 0, y: 0 };
    const item = createShapeItem({
      ...BASE,
      id: 'item_s',
      trackId: 'track_v1',
      frame: FRAME,
      shape: {
        kind: 'polygon',
        box: { x: 0, y: 0, width: 10, height: 10 },
        fill: { space: 'srgb-linear', rgba: [0, 0, 1, 1] },
        points: [origin, origin, { x: 10, y: 10 }],
      },
    }) as unknown as JsonObject;
    expect(() => snapshotProjectInput(item)).not.toThrow();
  });

  it('does not let a later edit to the caller reach into the Item', () => {
    const style: JsonObject = { fontSizePx: 40 };
    const box = { x: 0, y: 900, width: 1920, height: 120 };
    const item = createCaptionItem({
      ...BASE,
      id: 'item_c',
      trackId: 'track_c1',
      frame: FRAME,
      text: 'Line',
      box,
      style,
    });
    style.fontSizePx = 9_999;
    box.width = 1;
    expect(item.style.fontSizePx).toBe(40);
    expect((item.box as unknown as { width: number }).width).toBe(1920);
  });

  it.each([
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['an unsafe integer', 2 ** 53],
  ])('refuses a value that is %s, at the call that introduced it', (_label, value) => {
    expect(() =>
      createCaptionItem({
        ...BASE,
        id: 'item_c',
        trackId: 'track_c1',
        frame: FRAME,
        text: 'Line',
        box: { x: 0, y: 900, width: 1920, height: 120 },
        style: { fontSizePx: value },
      }),
    ).toThrow();
  });

  it('refuses text with no paragraphs, or a paragraph with no runs', () => {
    const base = {
      ...BASE,
      id: 'item_t',
      trackId: 'track_v1',
      frame: FRAME,
      box: { x: 0, y: 0, width: 100, height: 50 },
    } as const;
    expect(() => createTextItem({ ...base, paragraphs: [] })).toThrow(RangeError);
    expect(() => createTextItem({ ...base, paragraphs: [{ runs: [] }] })).toThrow(RangeError);
  });
});

describe('createTrack produces documents the validator accepts', () => {
  it.each([
    ['visual', 'track_v1'],
    ['audio', 'track_a1'],
    ['caption', 'track_c1'],
  ] as const)('a %s Track', (kind, id) => {
    const track = createTrack({ id, sequenceId: 'seq_main', kind }) as unknown as JsonObject;
    const result = validator.validate(projectWith([track], []));
    expect(result.ok).toBe(true);
  });

  it('a Track declaring a role and occupancy', () => {
    const track = createTrack({
      id: 'track_v1',
      sequenceId: 'seq_main',
      kind: 'visual',
      name: 'V1',
      role: 'storyline',
      occupancy: 'exclusive',
      locked: true,
      enabled: false,
    }) as unknown as JsonObject;
    const result = validator.validate(projectWith([track], []));
    expect(result.ok).toBe(true);
  });
});

describe('defaultVisual', () => {
  it('centres the layer in the frame', () => {
    const visual = defaultVisual(FRAME);
    expect(visual.transform.positionPx).toStrictEqual({ x: 960, y: 540 });
    expect(visual.opacity).toBe(1);
  });

  it.each([
    ['a zero width', { width: 0, height: 1080 }],
    ['a negative height', { width: 1920, height: -1 }],
  ])('refuses %s', (_label, frame) => {
    expect(() => defaultVisual(frame)).toThrow(RangeError);
  });

  it('refuses an opacity outside 0..1', () => {
    expect(() => defaultVisual(FRAME, { opacity: 1.5 })).toThrow(RangeError);
    expect(() => defaultVisual(FRAME, { opacity: -0 })).toThrow(RangeError);
  });

  it('refuses values that the stored media schema cannot represent', () => {
    expect(() => linearTimeMapping({ rate: { numerator: 1.5, denominator: 1 } })).toThrow(
      RangeError,
    );
    expect(() =>
      createVideoItem({
        ...BASE,
        id: 'item_v',
        trackId: 'track_v1',
        assetId: 'asset_a',
        frame: FRAME,
        streamIndex: 1_025,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createAudioItem({
        ...BASE,
        id: 'item_a',
        trackId: 'track_a1',
        assetId: 'asset_a',
        fadeInUs: -1,
      }),
    ).toThrow(RangeError);
  });
});
