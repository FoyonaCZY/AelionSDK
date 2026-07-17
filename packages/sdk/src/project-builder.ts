import {
  AelionError,
  frameStartUs,
  type JsonObject,
  type JsonValue,
  type Rational,
} from '@aelion/core';
import {
  ProjectValidator,
  canonicalClone,
  type AelionProject,
  type ItemEntity,
  type MarkerEntity,
  type TrackEntity,
} from '@aelion/project-schema';

import { defaultSchemas } from './default-schemas.js';
import type { ProductionMediaProvider, ProductionMediaProbe } from './production-media-provider.js';

const ENTITY_ID = /^[A-Za-z][A-Za-z0-9._:-]*$/u;

export interface CreateProjectOptions {
  readonly projectId?: string;
  readonly sequenceId?: string;
  readonly title?: string;
  readonly sequenceName?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: Rational;
  readonly sampleRate?: 44_100 | 48_000 | 96_000;
  readonly channelLayout?: 'mono' | 'stereo' | '5.1';
  /** Omit for content-derived duration. */
  readonly durationUs?: number;
}

export interface AddTrackOptions {
  readonly id?: string;
  readonly kind: 'visual' | 'audio' | 'caption';
  readonly name?: string;
  readonly enabled?: boolean;
  readonly locked?: boolean;
}

export interface AddAssetOptions {
  readonly id: string;
  readonly kind: 'video' | 'audio' | 'image' | 'font' | 'lut' | 'binary';
  readonly locator?: JsonObject;
  readonly name?: string;
  readonly mimeType?: string;
  readonly contentHash?: string;
  readonly byteLength?: number;
  readonly probeHint?: JsonObject;
  readonly representations?: readonly JsonObject[];
  readonly metadata?: JsonObject;
}

export interface AddMediaClipOptions {
  readonly id?: string;
  readonly kind: 'video' | 'audio';
  readonly assetId: string;
  readonly trackId: string;
  readonly atUs?: number;
  readonly durationUs: number;
  readonly sourceStartUs?: number;
  readonly sourceDurationUs?: number;
  readonly streamIndex?: number;
  readonly boundary?: 'error' | 'hold' | 'loop' | 'transparent';
  readonly name?: string;
  readonly fit?: 'contain' | 'cover' | 'fill' | 'none';
  readonly opacity?: number;
  readonly gainDb?: number;
  readonly pan?: number;
}

export interface ImportMediaOptions {
  readonly provider: Pick<ProductionMediaProvider, 'probe'>;
  readonly assetId: string;
  readonly atUs?: number;
  readonly durationUs?: number;
  readonly sourceStartUs?: number;
  readonly name?: string;
  readonly mimeType?: string;
  readonly videoTrackId?: string;
  readonly audioTrackId?: string;
  readonly video?: boolean;
  readonly audio?: boolean;
  readonly fit?: AddMediaClipOptions['fit'];
}

export interface ImportedMedia {
  readonly assetId: string;
  readonly durationUs: number;
  readonly probe: ProductionMediaProbe;
  readonly videoTrackId?: string;
  readonly audioTrackId?: string;
  readonly videoItemId?: string;
  readonly audioItemId?: string;
  readonly linkGroupId?: string;
}

export interface AddMarkerOptions {
  readonly id?: string;
  readonly timeUs: number;
  readonly durationUs?: number;
  readonly label?: string;
  readonly color?: string;
  readonly payload?: JsonValue;
  readonly itemId?: string;
}

function assertEntityId(value: string, name: string): void {
  if (value.length > 128 || !ENTITY_ID.test(value)) {
    throw new TypeError(`${name} must be a valid Aelion entity id`);
  }
}

function assertTime(value: number, name: string, positive = false): void {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(
      `${name} must be ${positive ? 'a positive' : 'a non-negative'} safe integer`,
    );
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function toMicroseconds(value: number, multiplier: number, name: string): number {
  assertFiniteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
  const result = Math.round(value * multiplier);
  if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe time range`);
  return result;
}

/** Convert seconds to canonical integer microseconds. */
export function seconds(value: number): number {
  return toMicroseconds(value, 1_000_000, 'seconds');
}

/** Convert milliseconds to canonical integer microseconds. */
export function milliseconds(value: number): number {
  return toMicroseconds(value, 1_000, 'milliseconds');
}

/** Return the exact quantized start time of a frame count. */
export function frames(
  value: number,
  frameRate: Rational = { numerator: 30, denominator: 1 },
): number {
  return frameStartUs(value, frameRate);
}

/** Create a validated Project v1 document through small, type-safe operations. */
export class ProjectBuilder {
  readonly #project: AelionProject;
  readonly #validator = new ProjectValidator({
    projectSchema: defaultSchemas.project,
    materialInstanceSchema: defaultSchemas.materialInstance,
  });
  readonly #counters = new Map<string, number>();

  public constructor(options: CreateProjectOptions = {}) {
    const projectId = options.projectId ?? 'project_1';
    const sequenceId = options.sequenceId ?? 'sequence_1';
    assertEntityId(projectId, 'projectId');
    assertEntityId(sequenceId, 'sequenceId');
    const width = options.width ?? 1920;
    const height = options.height ?? 1080;
    const frameRate = options.frameRate ?? { numerator: 30, denominator: 1 };
    if (!Number.isSafeInteger(width) || width <= 0 || width > 65_535) {
      throw new RangeError('width must be an integer from 1 to 65535');
    }
    if (!Number.isSafeInteger(height) || height <= 0 || height > 65_535) {
      throw new RangeError('height must be an integer from 1 to 65535');
    }
    if (
      !Number.isSafeInteger(frameRate.numerator) ||
      !Number.isSafeInteger(frameRate.denominator) ||
      frameRate.numerator <= 0 ||
      frameRate.denominator <= 0
    ) {
      throw new RangeError('frameRate must use positive safe integers');
    }
    if (options.durationUs !== undefined) assertTime(options.durationUs, 'durationUs');

    this.#project = {
      $schema: 'https://schemas.aelion.dev/project/v1.json',
      schemaVersion: '1.0.0',
      projectId,
      metadata: options.title === undefined ? {} : { title: options.title },
      settings: {
        defaultSequenceId: sequenceId,
        defaultStillDurationUs: seconds(3),
        missingAssetPolicy: 'error',
        missingMaterialPolicy: 'error',
        missingPluginPolicy: 'error',
      },
      assets: {},
      sequences: {
        [sequenceId]: {
          id: sequenceId,
          ...(options.sequenceName === undefined ? {} : { name: options.sequenceName }),
          format: {
            width,
            height,
            pixelAspectRatio: { numerator: 1, denominator: 1 },
            frameRate: { numerator: frameRate.numerator, denominator: frameRate.denominator },
            sampleRate: options.sampleRate ?? 48_000,
            channelLayout: options.channelLayout ?? 'stereo',
            workingColorSpace: 'srgb-linear',
            backgroundColor: { space: 'srgb-linear', rgba: [0, 0, 0, 1] },
          },
          duration:
            options.durationUs === undefined
              ? { mode: 'content' }
              : { mode: 'fixed', durationUs: options.durationUs, overflow: 'clip' },
          trackIds: [],
          transitionIds: [],
          materialInstanceIds: [],
          markerIds: [],
        },
      },
      tracks: {},
      items: {},
      materialInstances: {},
      transitions: {},
      markers: {},
      linkGroups: {},
      extensions: {},
    };
  }

  public get projectId(): string {
    return this.#project.projectId;
  }

  public get sequenceId(): string {
    return this.#project.settings.defaultSequenceId;
  }

  public addTrack(options: AddTrackOptions): string {
    const id = options.id ?? this.#nextId(`track_${options.kind}`);
    this.#assertUnused(id);
    const track: TrackEntity = {
      id,
      sequenceId: this.sequenceId,
      kind: options.kind,
      ...(options.name === undefined ? {} : { name: options.name }),
      enabled: options.enabled ?? true,
      locked: options.locked ?? false,
      itemIds: [],
      materialInstanceIds: [],
      ...(options.kind === 'audio'
        ? { audio: { gainDb: 0, pan: 0, muted: false, solo: false } }
        : {}),
    };
    this.#project.tracks[id] = track;
    this.#sequence().trackIds.push(id);
    return id;
  }

  public addAsset(options: AddAssetOptions): string {
    this.#assertUnused(options.id);
    if (options.contentHash !== undefined && !/^[0-9a-f]{64}$/u.test(options.contentHash)) {
      throw new TypeError('contentHash must be a lowercase SHA-256 value');
    }
    if (options.byteLength !== undefined) assertTime(options.byteLength, 'byteLength');
    this.#project.assets[options.id] = {
      id: options.id,
      kind: options.kind,
      locator: options.locator ?? { type: 'runtime-binding', bindingId: options.id },
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
      ...(options.contentHash === undefined
        ? {}
        : { contentHash: { algorithm: 'sha256', value: options.contentHash } }),
      ...(options.byteLength === undefined ? {} : { byteLength: options.byteLength }),
      ...(options.probeHint === undefined ? {} : { probeHint: options.probeHint }),
      ...(options.representations === undefined
        ? {}
        : { representations: [...options.representations] }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    };
    return options.id;
  }

  public addMediaClip(options: AddMediaClipOptions): string {
    const track = this.#project.tracks[options.trackId];
    if (track === undefined) throw new ReferenceError(`Unknown Track: ${options.trackId}`);
    const expectedTrack = options.kind === 'audio' ? 'audio' : 'visual';
    if (track.kind !== expectedTrack) {
      throw new TypeError(`${options.kind} clips require a ${expectedTrack} Track`);
    }
    if (this.#project.assets[options.assetId] === undefined) {
      throw new ReferenceError(`Unknown Asset: ${options.assetId}`);
    }
    const id = options.id ?? this.#nextId(`item_${options.kind}`);
    this.#assertUnused(id);
    const atUs = options.atUs ?? 0;
    const sourceStartUs = options.sourceStartUs ?? 0;
    const sourceDurationUs = options.sourceDurationUs ?? options.durationUs;
    const streamIndex = options.streamIndex ?? 0;
    assertTime(atUs, 'atUs');
    assertTime(options.durationUs, 'durationUs', true);
    assertTime(sourceStartUs, 'sourceStartUs');
    assertTime(sourceDurationUs, 'sourceDurationUs', true);
    assertTime(streamIndex, 'streamIndex');

    const source = {
      assetId: options.assetId,
      stream: { type: options.kind, index: streamIndex },
      sourceRange: { startUs: sourceStartUs, durationUs: sourceDurationUs },
      timeMapping: {
        type: 'linear',
        rate: { numerator: 1, denominator: 1 },
        reverse: false,
        boundary: options.boundary ?? 'hold',
      },
    };
    const item: ItemEntity =
      options.kind === 'video'
        ? {
            id,
            trackId: track.id,
            type: 'video',
            ...(options.name === undefined ? {} : { name: options.name }),
            enabled: true,
            range: { startUs: atUs, durationUs: options.durationUs },
            source,
            visual: this.#visual(options.fit ?? 'contain', options.opacity ?? 1),
            materialInstanceIds: [],
          }
        : {
            id,
            trackId: track.id,
            type: 'audio',
            ...(options.name === undefined ? {} : { name: options.name }),
            enabled: true,
            range: { startUs: atUs, durationUs: options.durationUs },
            source,
            audio: { gainDb: options.gainDb ?? 0, pan: options.pan ?? 0 },
            materialInstanceIds: [],
          };
    this.#project.items[id] = item;
    track.itemIds.push(id);
    return id;
  }

  public async importMedia(options: ImportMediaOptions): Promise<ImportedMedia> {
    assertEntityId(options.assetId, 'assetId');
    const probe = await options.provider.probe(options.assetId, { purpose: 'export' });
    const video = probe.index.tracks.find(track => track.kind === 'video');
    const audio = probe.index.tracks.find(track => track.kind === 'audio');
    const importVideo = (options.video ?? true) && video !== undefined;
    const importAudio = (options.audio ?? true) && audio !== undefined;
    if (!importVideo && !importAudio) {
      throw new TypeError('Media import did not find an enabled video or audio stream');
    }
    const sourceStartUs = options.sourceStartUs ?? 0;
    assertTime(sourceStartUs, 'sourceStartUs');
    const availableDurationUs = probe.index.durationUs - sourceStartUs;
    if (availableDurationUs <= 0) throw new RangeError('sourceStartUs is outside the media');
    const durationUs = options.durationUs ?? availableDurationUs;
    assertTime(durationUs, 'durationUs', true);
    if (durationUs > availableDurationUs) {
      throw new RangeError('durationUs exceeds the available source media');
    }
    if (this.#project.assets[options.assetId] === undefined) {
      this.addAsset({
        id: options.assetId,
        kind: importVideo ? 'video' : 'audio',
        ...(options.name === undefined ? {} : { name: options.name }),
        mimeType:
          options.mimeType ??
          `${importVideo ? 'video' : 'audio'}/${probe.index.container === 'mp4' ? 'mp4' : 'webm'}`,
        probeHint: {
          durationUs: probe.index.durationUs,
          ...(video === undefined
            ? {}
            : {
                width: video.codedWidth,
                height: video.codedHeight,
                videoCodec: video.codec,
              }),
          ...(audio === undefined ? {} : { audioCodec: audio.codec }),
        },
      });
    }

    const atUs = options.atUs ?? 0;
    assertTime(atUs, 'atUs');
    let videoTrackId: string | undefined;
    let audioTrackId: string | undefined;
    let videoItemId: string | undefined;
    let audioItemId: string | undefined;
    if (importVideo) {
      videoTrackId = this.#resolveTrack('visual', options.videoTrackId);
      videoItemId = this.addMediaClip({
        kind: 'video',
        assetId: options.assetId,
        trackId: videoTrackId,
        atUs,
        durationUs,
        sourceStartUs,
        sourceDurationUs: durationUs,
        streamIndex: probe.index.tracks.filter(track => track.kind === 'video').indexOf(video),
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.fit === undefined ? {} : { fit: options.fit }),
      });
    }
    if (importAudio) {
      audioTrackId = this.#resolveTrack('audio', options.audioTrackId);
      audioItemId = this.addMediaClip({
        kind: 'audio',
        assetId: options.assetId,
        trackId: audioTrackId,
        atUs,
        durationUs,
        sourceStartUs,
        sourceDurationUs: durationUs,
        streamIndex: probe.index.tracks.filter(track => track.kind === 'audio').indexOf(audio),
        ...(options.name === undefined ? {} : { name: options.name }),
      });
    }
    let linkGroupId: string | undefined;
    if (videoItemId !== undefined && audioItemId !== undefined) {
      linkGroupId = this.#nextId('link_av');
      this.#project.linkGroups[linkGroupId] = {
        id: linkGroupId,
        kind: 'av-sync',
        itemIds: [videoItemId, audioItemId],
        syncOffsetsUs: { [videoItemId]: 0, [audioItemId]: 0 },
      };
      this.#project.items[videoItemId] = {
        ...this.#project.items[videoItemId],
        linkGroupId,
      } as ItemEntity;
      this.#project.items[audioItemId] = {
        ...this.#project.items[audioItemId],
        linkGroupId,
      } as ItemEntity;
    }
    return {
      assetId: options.assetId,
      durationUs,
      probe,
      ...(videoTrackId === undefined ? {} : { videoTrackId }),
      ...(audioTrackId === undefined ? {} : { audioTrackId }),
      ...(videoItemId === undefined ? {} : { videoItemId }),
      ...(audioItemId === undefined ? {} : { audioItemId }),
      ...(linkGroupId === undefined ? {} : { linkGroupId }),
    };
  }

  public addMarker(options: AddMarkerOptions): string {
    const id = options.id ?? this.#nextId('marker');
    this.#assertUnused(id);
    assertTime(options.timeUs, 'timeUs');
    assertTime(options.durationUs ?? 0, 'durationUs');
    if (options.itemId !== undefined && this.#project.items[options.itemId] === undefined) {
      throw new ReferenceError(`Unknown Item: ${options.itemId}`);
    }
    const marker: MarkerEntity = {
      id,
      owner:
        options.itemId === undefined
          ? { type: 'sequence', id: this.sequenceId }
          : { type: 'item', id: options.itemId },
      timeUs: options.timeUs,
      durationUs: options.durationUs ?? 0,
      ...(options.label === undefined ? {} : { label: options.label }),
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    };
    this.#project.markers[id] = marker;
    if (options.itemId === undefined) this.#sequence().markerIds.push(id);
    else {
      const item = this.#project.items[options.itemId];
      if (item !== undefined) item.markerIds = [...(item.markerIds ?? []), id];
    }
    return id;
  }

  public build(): Readonly<AelionProject> {
    const candidate = canonicalClone(this.#project);
    const result = this.#validator.validate(candidate);
    if (!result.ok) throw new AelionError(result.diagnostics);
    return deepFreeze(result.value.project);
  }

  #sequence(): AelionProject['sequences'][string] {
    const sequence = this.#project.sequences[this.sequenceId];
    if (sequence === undefined) throw new Error('Default Sequence is missing');
    return sequence;
  }

  #resolveTrack(kind: 'visual' | 'audio', requestedId?: string): string {
    if (requestedId !== undefined) {
      const track = this.#project.tracks[requestedId];
      if (track === undefined) throw new ReferenceError(`Unknown Track: ${requestedId}`);
      if (track.kind !== kind) throw new TypeError(`${requestedId} is not a ${kind} Track`);
      return requestedId;
    }
    const existing = Object.values(this.#project.tracks).find(track => track.kind === kind);
    return existing?.id ?? this.addTrack({ kind });
  }

  #visual(fit: NonNullable<AddMediaClipOptions['fit']>, opacity: number): JsonObject {
    assertFiniteNumber(opacity, 'opacity');
    if (opacity < 0 || opacity > 1) throw new RangeError('opacity must be from 0 to 1');
    const sequence = this.#sequence();
    const format = sequence.format as JsonObject;
    const width = typeof format.width === 'number' ? format.width : 1920;
    const height = typeof format.height === 'number' ? format.height : 1080;
    return {
      fit,
      transform: {
        positionPx: { x: width / 2, y: height / 2 },
        anchor: { x: 0.5, y: 0.5 },
        scale: { x: 1, y: 1 },
        rotationDeg: 0,
        skewDeg: { x: 0, y: 0 },
      },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      opacity,
      blendMode: 'normal',
    };
  }

  #assertUnused(id: string): void {
    assertEntityId(id, 'entity id');
    for (const collection of [
      this.#project.assets,
      this.#project.sequences,
      this.#project.tracks,
      this.#project.items,
      this.#project.materialInstances,
      this.#project.transitions,
      this.#project.markers,
      this.#project.linkGroups,
    ]) {
      if (collection[id] !== undefined) throw new TypeError(`Entity id is already used: ${id}`);
    }
  }

  #nextId(prefix: string): string {
    let counter = this.#counters.get(prefix) ?? 0;
    for (;;) {
      counter += 1;
      const candidate = `${prefix}_${counter.toString()}`;
      try {
        this.#assertUnused(candidate);
        this.#counters.set(prefix, counter);
        return candidate;
      } catch (error) {
        if (
          !(error instanceof TypeError) ||
          !error.message.startsWith('Entity id is already used')
        ) {
          throw error;
        }
      }
    }
  }
}

export function createProject(options: CreateProjectOptions = {}): ProjectBuilder {
  return new ProjectBuilder(options);
}
