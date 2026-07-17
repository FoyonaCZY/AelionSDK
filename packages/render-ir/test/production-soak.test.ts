import type { AelionProject, ItemEntity } from '@aelion/project-schema';
import { describe, expect, it } from 'vitest';

import { evaluateVisualState, IncrementalRenderCompiler } from '../src/index.js';

const CLIP_COUNT = 1_000;
const CLIP_DURATION_US = 1_000_000;

function largeProject(): AelionProject {
  const itemIds = Array.from({ length: CLIP_COUNT }, (_, index) => `generator_${index.toString()}`);
  const items = Object.fromEntries(
    itemIds.map((id, index) => [
      id,
      {
        id,
        trackId: 'visual',
        type: 'generator',
        enabled: true,
        range: { startUs: index * CLIP_DURATION_US, durationUs: CLIP_DURATION_US },
        generator: {
          kind: 'solid',
          colors: [{ space: 'srgb-linear', rgba: [index % 2, 0, 0, 1] }],
        },
        visual: {
          fit: 'fill',
          transform: {
            positionPx: { x: 960, y: 540 },
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
      } satisfies ItemEntity,
    ]),
  );
  return {
    $schema: 'https://schemas.aelion.dev/project/v1.json',
    schemaVersion: '1.0.0',
    projectId: 'large-production-soak',
    metadata: {},
    settings: {
      defaultSequenceId: 'main',
      defaultStillDurationUs: CLIP_DURATION_US,
      missingAssetPolicy: 'error',
      missingMaterialPolicy: 'error',
      missingPluginPolicy: 'error',
    },
    assets: {},
    sequences: {
      main: {
        id: 'main',
        format: {
          width: 1_920,
          height: 1_080,
          pixelAspectRatio: { numerator: 1, denominator: 1 },
          frameRate: { numerator: 30, denominator: 1 },
          sampleRate: 48_000,
          channelLayout: 'stereo',
          workingColorSpace: 'srgb-linear',
          backgroundColor: { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
        },
        duration: { mode: 'fixed', durationUs: CLIP_COUNT * CLIP_DURATION_US, overflow: 'clip' },
        trackIds: ['visual'],
        transitionIds: [],
        materialInstanceIds: [],
        markerIds: [],
      },
    },
    tracks: {
      visual: {
        id: 'visual',
        sequenceId: 'main',
        kind: 'visual',
        enabled: true,
        locked: false,
        itemIds,
        materialInstanceIds: [],
      },
    },
    items,
    materialInstances: {},
    transitions: {},
    markers: {},
    linkGroups: {},
    extensions: {},
  };
}

describe('large Project accelerated soak', () => {
  it('compiles 1,000 clips, reuses unaffected IR and evaluates a long timeline repeatedly', () => {
    const compiler = new IncrementalRenderCompiler();
    const project = largeProject();
    const initial = compiler.compile(project, 'main', 0n);
    expect(initial.stats).toMatchObject({ compiledClips: CLIP_COUNT, reusedClips: 0 });

    const edited = structuredClone(project);
    const target = edited.items.generator_500 as
      | (ItemEntity & { visual: { opacity: number } })
      | undefined;
    if (target === undefined || target.type !== 'generator')
      throw new Error('Soak clip is missing');
    target.visual.opacity = 0.75;
    const incremental = compiler.compile(edited, 'main', 1n, {
      affectedEntityIds: ['generator_500'],
      affectedRanges: [
        { sequenceId: 'main', startUs: 500 * CLIP_DURATION_US, durationUs: CLIP_DURATION_US },
      ],
    });
    expect(incremental.stats).toMatchObject({ compiledClips: 1, reusedClips: CLIP_COUNT - 1 });
    expect(Object.isFrozen(incremental.ir)).toBe(true);

    let activeClips = 0;
    for (let iteration = 0; iteration < 5_000; iteration += 1) {
      const timeUs = (iteration * 791_919) % incremental.ir.durationUs;
      activeClips += evaluateVisualState(incremental.ir, timeUs).clips.length;
    }
    expect(activeClips).toBe(5_000);
  });
});
