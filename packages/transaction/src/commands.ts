import type { JsonObject, JsonValue } from '@aelion/core';
import { AelionError } from '@aelion/core';
import type { AelionProject, EntityId, ItemEntity, TrackEntity } from '@aelion/project-schema';

import type { TransactionHost } from './history.js';
import type { EditOptions, TransactionCommit } from './types.js';

export type CommandOptions = EditOptions;

export interface InsertItemOptions extends CommandOptions {
  readonly item: ItemEntity;
  readonly beforeItemId?: EntityId;
}

export interface RemoveItemOptions extends CommandOptions {
  readonly itemId: EntityId;
}

export interface MoveItemOptions extends CommandOptions {
  readonly itemId: EntityId;
  readonly toTrackId?: EntityId;
  readonly startUs?: number;
  /** Omit to preserve order on the same Track; null explicitly moves to the end. */
  readonly beforeItemId?: EntityId | null;
}

export interface TrimItemOptions extends CommandOptions {
  readonly itemId: EntityId;
  readonly edge: 'start' | 'end';
  /** New edge position in Sequence time. */
  readonly toUs: number;
}

export interface SplitItemOptions extends CommandOptions {
  readonly itemId: EntityId;
  readonly rightItemId: EntityId;
  /** Split position in Sequence time. */
  readonly atUs: number;
}

export interface SplitItemResult {
  readonly commit: TransactionCommit;
  readonly leftItemId: EntityId;
  readonly rightItemId: EntityId;
}

export interface ReplaceItemOptions extends CommandOptions {
  readonly itemId: EntityId;
  /**
   * Complete replacement entity. ID, Track and ownership references must stay
   * unchanged; structural relocation uses moveItem instead.
   */
  readonly replacement: ItemEntity;
}

export interface ReorderTrackOptions extends CommandOptions {
  readonly sequenceId: EntityId;
  readonly trackId: EntityId;
  readonly beforeTrackId?: EntityId;
}

export interface SetTrackFlagOptions extends CommandOptions {
  readonly trackId: EntityId;
  readonly value: boolean;
}

interface MediaSourceView {
  readonly sourceRange: { readonly startUs: number; readonly durationUs: number };
  readonly timeMapping: {
    readonly type: 'linear';
    readonly rate: { readonly numerator: number; readonly denominator: number };
    readonly reverse: boolean;
  };
}

function commandError(code: string, message: string, entityId?: string): AelionError {
  return new AelionError([
    {
      code,
      severity: 'error',
      message,
      ...(entityId === undefined ? {} : { entityId }),
      recoverable: true,
    },
  ]);
}

function assertTime(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw commandError('COMMAND_TIME_INVALID', `${name} must be a non-negative safe integer`);
  }
}

function itemIn(project: Readonly<AelionProject>, itemId: EntityId): ItemEntity {
  const item = project.items[itemId];
  if (item === undefined) {
    throw commandError('COMMAND_ITEM_MISSING', `Item ${itemId} does not exist`, itemId);
  }
  return item;
}

function trackIn(project: Readonly<AelionProject>, trackId: EntityId): TrackEntity {
  const track = project.tracks[trackId];
  if (track === undefined) {
    throw commandError('COMMAND_TRACK_MISSING', `Track ${trackId} does not exist`, trackId);
  }
  return track;
}

function assertUnlocked(track: TrackEntity): void {
  if (track.locked) {
    throw commandError('COMMAND_TRACK_LOCKED', `Track ${track.id} is locked`, track.id);
  }
}

function assertItemTrackCompatible(item: ItemEntity, track: TrackEntity): void {
  const requiredKind =
    item.type === 'audio' ? 'audio' : item.type === 'caption' ? 'caption' : 'visual';
  if (track.kind !== requiredKind) {
    throw commandError(
      'COMMAND_TRACK_KIND_MISMATCH',
      `Item ${item.id} requires a ${requiredKind} Track, not ${track.kind}`,
      item.id,
    );
  }
}

function assertAnchor(track: TrackEntity, beforeId: EntityId | undefined): void {
  if (beforeId !== undefined && !track.itemIds.includes(beforeId)) {
    throw commandError(
      'COMMAND_ITEM_ANCHOR_MISSING',
      `Item anchor ${beforeId} does not belong to Track ${track.id}`,
      beforeId,
    );
  }
}

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object'
    ? value
    : undefined;
}

function mediaSource(item: ItemEntity): MediaSourceView | undefined {
  const source = asObject(item.source);
  if (source === undefined) return undefined;
  const sourceRange = asObject(source.sourceRange);
  const timeMapping = asObject(source.timeMapping);
  const rate = asObject(timeMapping?.rate);
  if (
    sourceRange === undefined ||
    timeMapping === undefined ||
    timeMapping.type !== 'linear' ||
    rate === undefined ||
    typeof sourceRange.startUs !== 'number' ||
    typeof sourceRange.durationUs !== 'number' ||
    typeof rate.numerator !== 'number' ||
    typeof rate.denominator !== 'number' ||
    typeof timeMapping.reverse !== 'boolean'
  ) {
    throw commandError(
      'COMMAND_TIME_MAPPING_UNSUPPORTED',
      `Item ${item.id} does not have a supported linear media mapping`,
      item.id,
    );
  }
  return {
    sourceRange: {
      startUs: sourceRange.startUs,
      durationUs: sourceRange.durationUs,
    },
    timeMapping: {
      type: 'linear',
      rate: { numerator: rate.numerator, denominator: rate.denominator },
      reverse: timeMapping.reverse,
    },
  };
}

function scaledDuration(
  durationUs: number,
  rate: { readonly numerator: number; readonly denominator: number },
): number {
  return Math.floor((durationUs * rate.numerator) / rate.denominator);
}

function trimmedSourceRange(
  item: ItemEntity,
  edge: 'start' | 'end',
  removedDurationUs: number,
): { readonly startUs: number; readonly durationUs: number } | undefined {
  const source = mediaSource(item);
  if (source === undefined) return undefined;
  const removedSourceUs = scaledDuration(removedDurationUs, source.timeMapping.rate);
  const durationUs = source.sourceRange.durationUs - removedSourceUs;
  if (durationUs < 1) {
    throw commandError(
      'COMMAND_SOURCE_RANGE_EMPTY',
      `Trim would empty Item ${item.id}'s source range`,
      item.id,
    );
  }
  const advancesLowEdge =
    (!source.timeMapping.reverse && edge === 'start') ||
    (source.timeMapping.reverse && edge === 'end');
  return {
    startUs: source.sourceRange.startUs + (advancesLowEdge ? removedSourceUs : 0),
    durationUs,
  };
}

function splitSourceRanges(
  item: ItemEntity,
  leftDurationUs: number,
):
  | {
      readonly left: { readonly startUs: number; readonly durationUs: number };
      readonly right: { readonly startUs: number; readonly durationUs: number };
    }
  | undefined {
  const source = mediaSource(item);
  if (source === undefined) return undefined;
  const leftMappedUs = scaledDuration(leftDurationUs, source.timeMapping.rate);
  if (leftMappedUs < 1 || leftMappedUs >= source.sourceRange.durationUs) {
    throw commandError(
      'COMMAND_SOURCE_SPLIT_OUT_OF_RANGE',
      `Split point maps outside Item ${item.id}'s source range`,
      item.id,
    );
  }
  const rightMappedUs = source.sourceRange.durationUs - leftMappedUs;
  return source.timeMapping.reverse
    ? {
        left: {
          startUs: source.sourceRange.startUs + rightMappedUs,
          durationUs: leftMappedUs,
        },
        right: { startUs: source.sourceRange.startUs, durationUs: rightMappedUs },
      }
    : {
        left: { startUs: source.sourceRange.startUs, durationUs: leftMappedUs },
        right: {
          startUs: source.sourceRange.startUs + leftMappedUs,
          durationUs: rightMappedUs,
        },
      };
}

function sameIds(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function containsAnimation(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(entry => containsAnimation(entry));
  if (value === null || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'animation')) return true;
  return Object.values(value).some(entry => containsAnimation(entry));
}

function assertDirectTimeEditSupported(item: ItemEntity, command: 'move' | 'trim'): void {
  if (item.linkGroupId !== undefined) {
    throw commandError(
      `COMMAND_${command.toUpperCase()}_LINKED_UNSUPPORTED`,
      `Item ${item.id} is linked; edit the LinkGroup atomically or unlink it first`,
      item.id,
    );
  }
  if (command === 'trim' && containsAnimation(item)) {
    throw commandError(
      'COMMAND_TRIM_ANIMATION_UNSUPPORTED',
      `Item ${item.id} contains animation; an explicit keyframe trim policy is required`,
      item.id,
    );
  }
}

function commandEditOptions(options: CommandOptions, fallbackLabel: string): EditOptions {
  return {
    label: options.label ?? fallbackLabel,
    ...(options.baseRevision === undefined ? {} : { baseRevision: options.baseRevision }),
  };
}

/** Domain-level editing commands built exclusively from atomic transactions. */
export class EditingCommands {
  readonly #host: TransactionHost;

  public constructor(host: TransactionHost) {
    this.#host = host;
  }

  public insertItem(options: InsertItemOptions): TransactionCommit {
    const project = this.#host.getSnapshot();
    const track = trackIn(project, options.item.trackId);
    assertUnlocked(track);
    assertItemTrackCompatible(options.item, track);
    assertAnchor(track, options.beforeItemId);
    if (project.items[options.item.id] !== undefined) {
      throw commandError(
        'COMMAND_ITEM_EXISTS',
        `Item ${options.item.id} already exists`,
        options.item.id,
      );
    }
    return this.#host.edit(commandEditOptions(options, 'Insert item'), transaction => {
      transaction.createEntity('items', options.item.id, options.item);
      transaction.listInsert(
        'tracks',
        track.id,
        ['itemIds'],
        options.item.id,
        options.beforeItemId,
      );
    });
  }

  public removeItem(options: RemoveItemOptions): TransactionCommit {
    const project = this.#host.getSnapshot();
    const item = itemIn(project, options.itemId);
    const track = trackIn(project, item.trackId);
    assertUnlocked(track);
    return this.#host.edit(commandEditOptions(options, 'Remove item'), transaction => {
      for (const transition of Object.values(project.transitions)) {
        if (transition.fromItemId !== item.id && transition.toItemId !== item.id) continue;
        transaction.listRemove(
          'sequences',
          transition.sequenceId,
          ['transitionIds'],
          transition.id,
        );
        transaction.deleteEntity('transitions', transition.id);
        transaction.deleteEntity('materialInstances', transition.materialInstanceId);
      }

      const ownedMarkerIds = Object.values(project.markers)
        .filter(marker => {
          const owner = asObject(marker.owner);
          return owner?.type === 'item' && owner.id === item.id;
        })
        .map(marker => marker.id);
      const markerIds = new Set([...(item.markerIds ?? []), ...ownedMarkerIds]);
      for (const markerId of markerIds) {
        for (const sequence of Object.values(project.sequences)) {
          if (sequence.markerIds.includes(markerId)) {
            transaction.listRemove('sequences', sequence.id, ['markerIds'], markerId);
          }
        }
        if (project.markers[markerId] !== undefined) transaction.deleteEntity('markers', markerId);
      }

      if (item.linkGroupId !== undefined) {
        const group = project.linkGroups[item.linkGroupId];
        const ids = group?.itemIds;
        if (group !== undefined && Array.isArray(ids) && ids.every(id => typeof id === 'string')) {
          const remaining = ids.filter(id => id !== item.id);
          if (remaining.length < 2) {
            for (const remainingId of remaining) {
              if (project.items[remainingId]?.linkGroupId === group.id) {
                transaction.removeField('items', remainingId, ['linkGroupId']);
              }
            }
            transaction.deleteEntity('linkGroups', group.id);
          } else {
            transaction.listRemove('linkGroups', group.id, ['itemIds'], item.id);
            const offsets = asObject(group.syncOffsetsUs);
            if (offsets !== undefined && Object.hasOwn(offsets, item.id)) {
              transaction.removeField('linkGroups', group.id, ['syncOffsetsUs', item.id]);
            }
          }
        }
      }

      transaction.listRemove('tracks', track.id, ['itemIds'], item.id);
      transaction.deleteEntity('items', item.id);
      for (const materialId of item.materialInstanceIds) {
        transaction.deleteEntity('materialInstances', materialId);
      }
    });
  }

  public moveItem(options: MoveItemOptions): TransactionCommit {
    const project = this.#host.getSnapshot();
    const item = itemIn(project, options.itemId);
    const sourceTrack = trackIn(project, item.trackId);
    const targetTrack = trackIn(project, options.toTrackId ?? item.trackId);
    assertUnlocked(sourceTrack);
    assertUnlocked(targetTrack);
    assertItemTrackCompatible(item, targetTrack);
    assertDirectTimeEditSupported(item, 'move');
    if (options.startUs !== undefined) assertTime(options.startUs, 'startUs');
    const anchor = options.beforeItemId ?? undefined;
    assertAnchor(targetTrack, anchor);
    if (options.beforeItemId === item.id) {
      throw commandError(
        'COMMAND_ITEM_ANCHOR_INVALID',
        'An Item cannot be moved before itself',
        item.id,
      );
    }
    if (sourceTrack.id !== targetTrack.id) {
      const transition = Object.values(project.transitions).find(
        value => value.fromItemId === item.id || value.toItemId === item.id,
      );
      if (transition !== undefined) {
        throw commandError(
          'COMMAND_TRANSITION_TRACK_CONFLICT',
          `Item ${item.id} participates in Transition ${transition.id}; remove it before moving Tracks`,
          item.id,
        );
      }
    }
    if (
      sourceTrack.id === targetTrack.id &&
      options.startUs === undefined &&
      !Object.hasOwn(options, 'beforeItemId')
    ) {
      throw commandError('COMMAND_NO_CHANGE', `Move does not change Item ${item.id}`, item.id);
    }
    return this.#host.edit(commandEditOptions(options, 'Move item'), transaction => {
      if (sourceTrack.id !== targetTrack.id) {
        transaction.listRemove('tracks', sourceTrack.id, ['itemIds'], item.id);
        transaction.setField('items', item.id, ['trackId'], targetTrack.id);
        transaction.listInsert('tracks', targetTrack.id, ['itemIds'], item.id, anchor);
      } else if (Object.hasOwn(options, 'beforeItemId')) {
        transaction.listMove('tracks', sourceTrack.id, ['itemIds'], item.id, anchor);
      }
      if (options.startUs !== undefined && options.startUs !== item.range.startUs) {
        transaction.setField('items', item.id, ['range', 'startUs'], options.startUs);
      }
    });
  }

  public trimItem(options: TrimItemOptions): TransactionCommit {
    const project = this.#host.getSnapshot();
    const item = itemIn(project, options.itemId);
    assertUnlocked(trackIn(project, item.trackId));
    assertDirectTimeEditSupported(item, 'trim');
    assertTime(options.toUs, 'toUs');
    const endUs = item.range.startUs + item.range.durationUs;
    if (options.toUs <= item.range.startUs || options.toUs >= endUs) {
      throw commandError(
        'COMMAND_TRIM_OUT_OF_RANGE',
        `Trim point must be inside Item ${item.id}`,
        item.id,
      );
    }
    const removedDurationUs =
      options.edge === 'start' ? options.toUs - item.range.startUs : endUs - options.toUs;
    const newDurationUs = item.range.durationUs - removedDurationUs;
    const sourceRange = trimmedSourceRange(item, options.edge, removedDurationUs);
    for (const transition of Object.values(project.transitions)) {
      if (transition.fromItemId !== item.id && transition.toItemId !== item.id) continue;
      const transitionEnd = transition.range.startUs + transition.range.durationUs;
      const newStart = options.edge === 'start' ? options.toUs : item.range.startUs;
      const newEnd = options.edge === 'end' ? options.toUs : endUs;
      if (transition.range.startUs < newStart || transitionEnd > newEnd) {
        throw commandError(
          'COMMAND_TRIM_TRANSITION_CONFLICT',
          `Trim would remove part of Transition ${transition.id}`,
          item.id,
        );
      }
    }
    return this.#host.edit(commandEditOptions(options, 'Trim item'), transaction => {
      if (options.edge === 'start') {
        transaction.setField('items', item.id, ['range', 'startUs'], options.toUs);
      }
      transaction.setField('items', item.id, ['range', 'durationUs'], newDurationUs);
      if (sourceRange !== undefined) {
        transaction.setField(
          'items',
          item.id,
          ['source', 'sourceRange', 'startUs'],
          sourceRange.startUs,
        );
        transaction.setField(
          'items',
          item.id,
          ['source', 'sourceRange', 'durationUs'],
          sourceRange.durationUs,
        );
      }
    });
  }

  public splitItem(options: SplitItemOptions): SplitItemResult {
    const project = this.#host.getSnapshot();
    const item = itemIn(project, options.itemId);
    const track = trackIn(project, item.trackId);
    assertUnlocked(track);
    assertTime(options.atUs, 'atUs');
    const endUs = item.range.startUs + item.range.durationUs;
    if (options.atUs <= item.range.startUs || options.atUs >= endUs) {
      throw commandError(
        'COMMAND_SPLIT_OUT_OF_RANGE',
        `Split point must be inside Item ${item.id}`,
        item.id,
      );
    }
    if (project.items[options.rightItemId] !== undefined || options.rightItemId === item.id) {
      throw commandError(
        'COMMAND_ITEM_EXISTS',
        `Right Item ID ${options.rightItemId} already exists`,
        options.rightItemId,
      );
    }
    if (item.materialInstanceIds.length > 0 || (item.markerIds?.length ?? 0) > 0) {
      throw commandError(
        'COMMAND_SPLIT_OWNED_ENTITY_UNSUPPORTED',
        `Item ${item.id} owns Material or Marker entities; explicit split policies are required`,
        item.id,
      );
    }
    if (containsAnimation(item)) {
      throw commandError(
        'COMMAND_SPLIT_ANIMATION_UNSUPPORTED',
        `Item ${item.id} contains animation; an explicit keyframe split policy is required`,
        item.id,
      );
    }
    if (item.linkGroupId !== undefined) {
      throw commandError(
        'COMMAND_SPLIT_LINKED_UNSUPPORTED',
        `Item ${item.id} is linked; split the LinkGroup atomically or unlink it first`,
        item.id,
      );
    }
    const leftDurationUs = options.atUs - item.range.startUs;
    const rightDurationUs = endUs - options.atUs;
    const sourceRanges = splitSourceRanges(item, leftDurationUs);
    const leftSourceRange = sourceRanges?.left;
    const rightSourceRange = sourceRanges?.right;
    for (const transition of Object.values(project.transitions)) {
      const transitionEnd = transition.range.startUs + transition.range.durationUs;
      if (
        (transition.fromItemId === item.id || transition.toItemId === item.id) &&
        options.atUs > transition.range.startUs &&
        options.atUs < transitionEnd
      ) {
        throw commandError(
          'COMMAND_SPLIT_TRANSITION_CONFLICT',
          `Split point intersects Transition ${transition.id}`,
          item.id,
        );
      }
    }
    const right = structuredClone(item);
    right.id = options.rightItemId;
    Reflect.set(right.range, 'startUs', options.atUs);
    Reflect.set(right.range, 'durationUs', rightDurationUs);
    if (rightSourceRange !== undefined) {
      const source = asObject(right.source);
      const range = asObject(source?.sourceRange);
      if (range !== undefined) {
        range.startUs = rightSourceRange.startUs;
        range.durationUs = rightSourceRange.durationUs;
      }
    }
    const itemIndex = track.itemIds.indexOf(item.id);
    const beforeId = track.itemIds[itemIndex + 1];
    const commit = this.#host.edit(commandEditOptions(options, 'Split item'), transaction => {
      transaction.setField('items', item.id, ['range', 'durationUs'], leftDurationUs);
      if (leftSourceRange !== undefined) {
        transaction.setField(
          'items',
          item.id,
          ['source', 'sourceRange', 'startUs'],
          leftSourceRange.startUs,
        );
        transaction.setField(
          'items',
          item.id,
          ['source', 'sourceRange', 'durationUs'],
          leftSourceRange.durationUs,
        );
      }
      transaction.createEntity('items', right.id, right);
      transaction.listInsert('tracks', track.id, ['itemIds'], right.id, beforeId);
      for (const transition of Object.values(project.transitions)) {
        if (transition.range.startUs < options.atUs) continue;
        if (transition.fromItemId === item.id) {
          transaction.setField('transitions', transition.id, ['fromItemId'], right.id);
        }
        if (transition.toItemId === item.id) {
          transaction.setField('transitions', transition.id, ['toItemId'], right.id);
        }
      }
    });
    return { commit, leftItemId: item.id, rightItemId: right.id };
  }

  public replaceItem(options: ReplaceItemOptions): TransactionCommit {
    const project = this.#host.getSnapshot();
    const item = itemIn(project, options.itemId);
    assertUnlocked(trackIn(project, item.trackId));
    const replacement = options.replacement;
    assertItemTrackCompatible(replacement, trackIn(project, item.trackId));
    if (replacement.id !== item.id || replacement.trackId !== item.trackId) {
      throw commandError(
        'COMMAND_REPLACE_TOPOLOGY_CHANGED',
        'Replacement must preserve Item id and trackId; use moveItem for relocation',
        item.id,
      );
    }
    if (
      !sameIds(replacement.materialInstanceIds, item.materialInstanceIds) ||
      !sameIds(replacement.markerIds, item.markerIds) ||
      replacement.linkGroupId !== item.linkGroupId
    ) {
      throw commandError(
        'COMMAND_REPLACE_OWNERSHIP_CHANGED',
        'Replacement must preserve Material, Marker and LinkGroup ownership references',
        item.id,
      );
    }
    return this.#host.edit(commandEditOptions(options, 'Replace item'), transaction => {
      transaction.deleteEntity('items', item.id);
      transaction.createEntity('items', item.id, replacement);
    });
  }

  public reorderTrack(options: ReorderTrackOptions): TransactionCommit {
    const project = this.#host.getSnapshot();
    const sequence = project.sequences[options.sequenceId];
    if (!sequence?.trackIds.includes(options.trackId)) {
      throw commandError(
        'COMMAND_TRACK_SEQUENCE_MISMATCH',
        `Track ${options.trackId} does not belong to Sequence ${options.sequenceId}`,
        options.trackId,
      );
    }
    if (options.beforeTrackId !== undefined && !sequence.trackIds.includes(options.beforeTrackId)) {
      throw commandError(
        'COMMAND_TRACK_ANCHOR_MISSING',
        `Track anchor ${options.beforeTrackId} does not belong to Sequence ${sequence.id}`,
        options.beforeTrackId,
      );
    }
    return this.#host.edit(commandEditOptions(options, 'Reorder track'), transaction => {
      transaction.listMove(
        'sequences',
        sequence.id,
        ['trackIds'],
        options.trackId,
        options.beforeTrackId,
      );
    });
  }

  public setTrackLocked(options: SetTrackFlagOptions): TransactionCommit {
    trackIn(this.#host.getSnapshot(), options.trackId);
    return this.#host.edit(commandEditOptions(options, 'Set track lock'), transaction => {
      transaction.setField('tracks', options.trackId, ['locked'], options.value);
    });
  }

  public setTrackEnabled(options: SetTrackFlagOptions): TransactionCommit {
    trackIn(this.#host.getSnapshot(), options.trackId);
    return this.#host.edit(commandEditOptions(options, 'Set track enabled'), transaction => {
      transaction.setField('tracks', options.trackId, ['enabled'], options.value);
    });
  }

  public setTrackMuted(options: SetTrackFlagOptions): TransactionCommit {
    const track = trackIn(this.#host.getSnapshot(), options.trackId);
    if (track.kind !== 'audio' || asObject(track.audio) === undefined) {
      throw commandError(
        'COMMAND_TRACK_AUDIO_REQUIRED',
        `Track ${track.id} is not an audio Track with mixer properties`,
        track.id,
      );
    }
    return this.#host.edit(commandEditOptions(options, 'Set track mute'), transaction => {
      transaction.setField('tracks', options.trackId, ['audio', 'muted'], options.value);
    });
  }
}
