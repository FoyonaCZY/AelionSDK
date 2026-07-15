import type { JsonObject, JsonValue, Rational } from '@aelion/core';

export type EntityId = string;
export type CollectionName =
  | 'assets'
  | 'sequences'
  | 'tracks'
  | 'items'
  | 'materialInstances'
  | 'transitions'
  | 'markers'
  | 'linkGroups';

export interface TimeRange {
  readonly startUs: number;
  readonly durationUs: number;
}

export interface ProjectSettings extends JsonObject {
  defaultSequenceId: EntityId;
  defaultStillDurationUs: number;
  missingAssetPolicy: 'placeholder' | 'error';
  missingMaterialPolicy: 'placeholder' | 'error';
  missingPluginPolicy: 'placeholder' | 'error';
  locale?: string;
  timezone?: string;
}

export interface ProjectEntity extends JsonObject {
  id: EntityId;
}

export interface SequenceEntity extends ProjectEntity {
  trackIds: EntityId[];
  transitionIds: EntityId[];
  materialInstanceIds: EntityId[];
  markerIds: EntityId[];
}

export interface TrackEntity extends ProjectEntity {
  sequenceId: EntityId;
  kind: 'visual' | 'audio' | 'caption';
  enabled: boolean;
  locked: boolean;
  itemIds: EntityId[];
  materialInstanceIds: EntityId[];
}

export interface ItemEntity extends ProjectEntity {
  trackId: EntityId;
  type: string;
  enabled: boolean;
  range: TimeRange & JsonObject;
  materialInstanceIds: EntityId[];
  markerIds?: EntityId[];
  linkGroupId?: EntityId;
}

export interface TransitionEntity extends ProjectEntity {
  sequenceId: EntityId;
  trackId: EntityId;
  fromItemId: EntityId;
  toItemId: EntityId;
  range: TimeRange & JsonObject;
  materialInstanceId: EntityId;
}

export interface MaterialInstanceEntity extends ProjectEntity {
  definition: JsonObject;
  enabled: boolean;
  parameters: JsonObject;
}

export interface AelionProject extends JsonObject {
  $schema: string;
  schemaVersion: string;
  projectId: EntityId;
  metadata: JsonObject;
  settings: ProjectSettings;
  assets: Record<EntityId, ProjectEntity>;
  sequences: Record<EntityId, SequenceEntity>;
  tracks: Record<EntityId, TrackEntity>;
  items: Record<EntityId, ItemEntity>;
  materialInstances: Record<EntityId, MaterialInstanceEntity>;
  transitions: Record<EntityId, TransitionEntity>;
  markers: Record<EntityId, ProjectEntity>;
  linkGroups: Record<EntityId, ProjectEntity>;
  extensions: Record<string, JsonValue>;
}

export interface FrameFormat {
  readonly width: number;
  readonly height: number;
  readonly pixelAspectRatio: Rational;
  readonly frameRate: Rational;
  readonly sampleRate: 44_100 | 48_000 | 96_000;
  readonly channelLayout: 'mono' | 'stereo' | '5.1';
}

export const COLLECTION_NAMES: readonly CollectionName[] = [
  'assets',
  'sequences',
  'tracks',
  'items',
  'materialInstances',
  'transitions',
  'markers',
  'linkGroups',
] as const;
