import type { JsonObject } from '@aelion/core';
import type { AelionProject } from '@aelion/project-schema';
import { ProjectValidator } from '@aelion/project-schema';
import { IncrementalRenderCompiler } from '@aelion/render-ir';
import { TransactionEngine } from '@aelion/transaction';
import { bench, describe } from 'vitest';

import materialInstanceSchema from '../schemas/material/v1/instance.schema.json';
import projectSchema from '../schemas/project/v1/project.schema.json';

function project(itemCount: number): AelionProject {
  const itemIds = Array.from({ length: itemCount }, (_, index) => `item_${index.toString()}`);
  return {
    $schema: 'https://schemas.aelion.dev/project/v1.json',
    schemaVersion: '1.0.0',
    projectId: 'benchmark',
    metadata: {},
    settings: {
      defaultSequenceId: 'sequence',
      defaultStillDurationUs: 1_000_000,
      missingAssetPolicy: 'error',
      missingMaterialPolicy: 'error',
      missingPluginPolicy: 'error',
    },
    assets: {
      asset: {
        id: 'asset',
        kind: 'video',
        locator: { type: 'runtime-binding', bindingId: 'asset' },
      },
    },
    sequences: {
      sequence: {
        id: 'sequence',
        format: {
          width: 1920,
          height: 1080,
          pixelAspectRatio: { numerator: 1, denominator: 1 },
          frameRate: { numerator: 30, denominator: 1 },
          sampleRate: 48_000,
          channelLayout: 'stereo',
          workingColorSpace: 'srgb-linear',
          backgroundColor: { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
        },
        duration: { mode: 'content' },
        trackIds: ['track'],
        transitionIds: [],
        materialInstanceIds: [],
        markerIds: [],
      },
    },
    tracks: {
      track: {
        id: 'track',
        sequenceId: 'sequence',
        kind: 'visual',
        enabled: true,
        locked: false,
        itemIds,
        materialInstanceIds: [],
      },
    },
    items: Object.fromEntries(
      itemIds.map((id, index) => [
        id,
        {
          id,
          trackId: 'track',
          type: 'video',
          enabled: true,
          range: { startUs: index * 1_000_000, durationUs: 1_000_000 },
          source: {
            assetId: 'asset',
            stream: { type: 'video', index: 0 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
            timeMapping: {
              type: 'linear',
              rate: { numerator: 1, denominator: 1 },
              reverse: false,
              boundary: 'error',
            },
          },
          visual: {
            fit: 'cover',
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
        },
      ]),
    ),
    materialInstances: {},
    transitions: {},
    markers: {},
    linkGroups: {},
    extensions: {},
  } as unknown as AelionProject;
}

describe('Render IR compilation', () => {
  const fixture = project(1_000);

  bench('cold compile 1,000 clips', () => {
    new IncrementalRenderCompiler().compile(fixture, 'sequence', 0n);
  });

  const compiler = new IncrementalRenderCompiler();
  compiler.compile(fixture, 'sequence', 0n);
  bench('incremental no-op compile 1,000 clips', () => {
    compiler.compile(fixture, 'sequence', 1n, { affectedEntityIds: [] });
  });

  bench('session initialization 1,000 clips', () => {
    new TransactionEngine(fixture, () => ({ ok: true, diagnostics: [] }));
  });

  const transactionEngine = new TransactionEngine(fixture, () => ({
    ok: true,
    diagnostics: [],
  }));
  let transactionIteration = 0;
  bench('single-field transaction commit 1,000 clips', () => {
    const value = transactionIteration;
    transactionIteration += 1;
    transactionEngine.edit({ baseRevision: transactionEngine.revision }, edit => {
      edit.setField('items', 'item_500', ['metadata'], { value });
    });
  });

  const validator = new ProjectValidator({
    projectSchema: projectSchema as JsonObject,
    materialInstanceSchema: materialInstanceSchema as JsonObject,
  });
  const validatedTransactionEngine = new TransactionEngine(fixture, value => {
    const result = validator.validate(value);
    return { ok: result.ok, diagnostics: result.diagnostics };
  });
  let validatedIteration = 0;
  bench('schema-validated field commit 1,000 clips', () => {
    const value = validatedIteration;
    validatedIteration += 1;
    validatedTransactionEngine.edit({ baseRevision: validatedTransactionEngine.revision }, edit => {
      edit.setField('items', 'item_500', ['metadata'], { value });
    });
  });
});
