import type { SampleIndex } from '@aelion/media';
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
});
