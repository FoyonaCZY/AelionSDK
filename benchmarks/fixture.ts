import type { JsonObject } from '@aelionsdk/core';
import { createAudioItem, createTextItem, createTrack, createVideoItem } from '@aelionsdk/sdk';
import type { AelionProject } from '@aelionsdk/project-schema';

import materialInstanceSchema from '../schemas/material/v1/instance.schema.json';
import projectSchema from '../schemas/project/v2.0/project.schema.json';

/**
 * The Project shapes the benchmarks measure against.
 *
 * A single flat Track of identical clips is the shape that flatters an engine
 * most: one Track to scan, no links to follow, no overlays stacked over the
 * cut. Real timelines are none of those things, so the scenarios here build a
 * document an editor would actually be holding -- a packed storyline, an
 * overlay lane, audio linked to picture, markers and per-clip material -- and
 * the numbers are reported against that.
 */

export const FRAME = { width: 1920, height: 1080 } as const;
export const CLIP_DURATION_US = 4_000_000;

export const schemas = {
  project: projectSchema as unknown as JsonObject,
  materialInstance: materialInstanceSchema as unknown as JsonObject,
};

export interface EditingProjectOptions {
  /** Clips on the storyline. Audio partners and overlays scale from this. */
  readonly clips: number;
  /** Link each storyline clip to an audio Item on its own Track. Defaults to true. */
  readonly linkedAudio?: boolean;
  /** One overlay Item per this many clips. Defaults to 4; 0 disables overlays. */
  readonly overlayEvery?: number;
  /** One Sequence marker per this many clips. Defaults to 8; 0 disables markers. */
  readonly markerEvery?: number;
  /** One Material instance per this many clips. Defaults to 4; 0 disables materials. */
  readonly materialEvery?: number;
}

interface Collections {
  readonly assets: Record<string, JsonObject>;
  readonly tracks: Record<string, JsonObject>;
  readonly items: Record<string, JsonObject>;
  readonly markers: Record<string, JsonObject>;
  readonly linkGroups: Record<string, JsonObject>;
  readonly materialInstances: Record<string, JsonObject>;
}

const ASSETS_PER_CLIP = 8;

function colorMaterial(id: string): JsonObject {
  return {
    id,
    name: 'Exposure',
    definition: {
      packageId: 'aelion.builtin.color',
      packageVersion: '1.0.0',
      packageIntegrity: `sha256:${'0'.repeat(64)}`,
      materialId: 'Exposure',
    },
    enabled: true,
    previewPolicy: 'skippable-when-degraded',
    parameters: { stops: 0.25, contrast: 1.05 },
  };
}

/**
 * Builds a valid Project v1.2 document with `clips` storyline clips.
 *
 * Deterministic: the same options always produce the same document, so a
 * benchmark run compares against the previous run rather than against noise.
 */
export function editingProject(options: EditingProjectOptions): AelionProject {
  const { clips } = options;
  const linkedAudio = options.linkedAudio ?? true;
  const overlayEvery = options.overlayEvery ?? 4;
  const markerEvery = options.markerEvery ?? 8;
  const materialEvery = options.materialEvery ?? 4;

  const collections: Collections = {
    assets: {},
    tracks: {},
    items: {},
    markers: {},
    linkGroups: {},
    materialInstances: {},
  };

  const assetCount = Math.max(1, Math.ceil(clips / ASSETS_PER_CLIP));
  for (let index = 0; index < assetCount; index += 1) {
    collections.assets[`asset_${index.toString()}`] = {
      id: `asset_${index.toString()}`,
      kind: 'video',
      locator: { type: 'runtime-binding', bindingId: `asset_${index.toString()}` },
    };
  }

  const storyline = createTrack({
    id: 'track_v1',
    sequenceId: 'seq_main',
    kind: 'visual',
    name: 'V1',
    role: 'storyline',
  }) as unknown as JsonObject;
  const overlay = createTrack({
    id: 'track_v2',
    sequenceId: 'seq_main',
    kind: 'visual',
    name: 'V2',
  }) as unknown as JsonObject;
  const audioTrack = createTrack({
    id: 'track_a1',
    sequenceId: 'seq_main',
    kind: 'audio',
    name: 'A1',
  }) as unknown as JsonObject;

  const storylineIds: string[] = [];
  const overlayIds: string[] = [];
  const audioIds: string[] = [];
  const markerIds: string[] = [];
  const sequenceMaterialIds: string[] = [];

  for (let index = 0; index < clips; index += 1) {
    const atUs = index * CLIP_DURATION_US;
    const assetId = `asset_${(index % assetCount).toString()}`;
    const videoId = `item_v_${index.toString()}`;
    const video = createVideoItem({
      id: videoId,
      trackId: 'track_v1',
      atUs,
      durationUs: CLIP_DURATION_US,
      assetId,
      sourceStartUs: (index % 5) * 1_000_000,
      frame: FRAME,
      fit: 'cover',
    }) as unknown as JsonObject;

    if (materialEvery > 0 && index % materialEvery === 0) {
      const materialId = `mat_${index.toString()}`;
      collections.materialInstances[materialId] = colorMaterial(materialId);
      video.materialInstanceIds = [materialId];
    }

    if (linkedAudio) {
      const audioId = `item_a_${index.toString()}`;
      const groupId = `link_${index.toString()}`;
      const audio = createAudioItem({
        id: audioId,
        trackId: 'track_a1',
        atUs,
        durationUs: CLIP_DURATION_US,
        assetId,
        fadeInUs: 100_000,
        fadeOutUs: 100_000,
      }) as unknown as JsonObject;
      audio.linkGroupId = groupId;
      video.linkGroupId = groupId;
      collections.linkGroups[groupId] = {
        id: groupId,
        kind: 'av-sync',
        itemIds: [videoId, audioId],
      };
      collections.items[audioId] = audio;
      audioIds.push(audioId);
    }

    collections.items[videoId] = video;
    storylineIds.push(videoId);

    if (overlayEvery > 0 && index % overlayEvery === 0) {
      const textId = `item_t_${index.toString()}`;
      collections.items[textId] = createTextItem({
        id: textId,
        trackId: 'track_v2',
        atUs: atUs + 250_000,
        durationUs: CLIP_DURATION_US - 500_000,
        frame: FRAME,
        box: { x: 160, y: 780, width: 1600, height: 200 },
        paragraphs: [
          {
            style: { align: 'center', lineHeight: 1.2 },
            runs: [
              {
                text: `Shot ${index.toString()}`,
                style: { fontFamily: 'Inter', fontSizePx: 56 },
              },
            ],
          },
        ],
      }) as unknown as JsonObject;
      overlayIds.push(textId);
    }

    if (markerEvery > 0 && index % markerEvery === 0) {
      const markerId = `marker_${index.toString()}`;
      collections.markers[markerId] = {
        id: markerId,
        owner: { type: 'sequence', id: 'seq_main' },
        timeUs: atUs,
        durationUs: 0,
        label: `Beat ${index.toString()}`,
        color: '#ff9f0a',
      };
      markerIds.push(markerId);
    }
  }

  storyline.itemIds = storylineIds;
  overlay.itemIds = overlayIds;
  audioTrack.itemIds = audioIds;
  collections.tracks.track_v1 = storyline;
  collections.tracks.track_v2 = overlay;
  collections.tracks.track_a1 = audioTrack;

  const trackIds = linkedAudio ? ['track_v1', 'track_v2', 'track_a1'] : ['track_v1', 'track_v2'];
  if (!linkedAudio) delete collections.tracks.track_a1;

  return {
    $schema: 'https://schemas.aelion.dev/project/v2.0.json',
    schemaVersion: '2.0.0',
    projectId: 'proj_benchmark',
    metadata: { name: 'Benchmark timeline' },
    settings: {
      defaultSequenceId: 'seq_main',
      defaultStillDurationUs: 5_000_000,
      missingAssetPolicy: 'error',
      missingMaterialPolicy: 'error',
      missingPluginPolicy: 'error',
    },
    assets: collections.assets,
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
        trackIds,
        transitionIds: [],
        materialInstanceIds: sequenceMaterialIds,
        markerIds,
      },
    },
    tracks: collections.tracks,
    items: collections.items,
    materialInstances: collections.materialInstances,
    transitions: {},
    markers: collections.markers,
    linkGroups: collections.linkGroups,
    extensions: {},
  } as unknown as AelionProject;
}

/** Sequence time in the middle of the timeline, where exactly one clip is live. */
export function midpointUs(clips: number): number {
  return Math.floor((clips * CLIP_DURATION_US) / 2) + 1;
}
