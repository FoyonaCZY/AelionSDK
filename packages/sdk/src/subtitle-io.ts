import { parseSrt, parseWebVtt, serializeSrt, serializeWebVtt } from '@aelionsdk/render-ir';
import type { AelionProject, ItemEntity } from '@aelionsdk/project-schema';

import type { ProjectBuilder } from './project-builder.js';

export type SubtitleFormat = 'srt' | 'vtt';

export interface SubtitleCue {
  readonly id?: string;
  readonly startUs: number;
  readonly endUs: number;
  readonly text: string;
  readonly settings?: Readonly<Record<string, string>>;
}

export interface ImportSubtitleResult {
  readonly itemIds: readonly string[];
  readonly cueCount: number;
  readonly warnings: readonly string[];
}

export interface ExportSubtitleResult {
  readonly text: string;
  readonly cueCount: number;
  readonly warnings: readonly string[];
}

export interface ImportSubtitleOptions {
  readonly trackId: string;
  readonly text: string;
  readonly format: SubtitleFormat;
  /** Align every cue start so it does not begin inside a silent audio range. */
  readonly alignToSilence?: readonly {
    readonly startUs: number;
    readonly durationUs: number;
  }[];
  readonly atUs?: number;
}

function cueToOptions(cue: SubtitleCue): {
  readonly atUs: number;
  readonly durationUs: number;
  readonly text: string;
  readonly cueSettings?: Record<string, string>;
} {
  return {
    atUs: cue.startUs,
    durationUs: cue.endUs - cue.startUs,
    text: cue.text,
    ...(cue.settings === undefined ? {} : { cueSettings: { ...cue.settings } }),
  };
}

/**
 * Import an SRT or WebVTT document into a caption track. Every cue becomes a
 * caption clip with its timeline range and text; parse or range failures fail
 * closed without mutating the builder.
 */
export function importSubtitleTrack(
  builder: ProjectBuilder,
  options: ImportSubtitleOptions,
): ImportSubtitleResult {
  const cues = options.format === 'srt' ? parseSrt(options.text) : parseWebVtt(options.text);
  const warnings: string[] = [];
  let previousEndUs = options.atUs ?? 0;
  const itemIds: string[] = [];
  for (const cue of cues) {
    let startUs = cue.startUs;
    if (options.alignToSilence !== undefined) {
      const aligned = alignCueToSilence(cue, options.alignToSilence);
      if (aligned.startUs !== cue.startUs) {
        warnings.push(`Cue at ${cue.startUs} moved to ${aligned.startUs} to avoid silence`);
      }
      startUs = aligned.startUs;
    }
    if (startUs < previousEndUs) {
      throw new TypeError(
        `CAPTION_IMPORT_OVERLAP: cue at ${startUs} overlaps the previous cue ending at ${previousEndUs}`,
      );
    }
    const id = builder.addCaptionClip({
      trackId: options.trackId,
      ...cueToOptions({ ...cue, startUs }),
    });
    itemIds.push(id);
    previousEndUs = startUs + (cue.endUs - cue.startUs);
  }
  return { itemIds, cueCount: cues.length, warnings };
}

/**
 * Export a caption track back to SRT or WebVTT text. Caption clips must have
 * non-overlapping positive ranges; otherwise export fails closed.
 */
export function exportSubtitleTrack(
  project: AelionProject,
  trackId: string,
  format: SubtitleFormat,
): ExportSubtitleResult {
  const track = project.tracks[trackId];
  if (track === undefined) throw new ReferenceError(`Unknown Track: ${trackId}`);
  if (track.kind !== 'caption') throw new TypeError('subtitle export requires a caption Track');
  const cues: SubtitleCue[] = track.itemIds
    .map(itemId => project.items[itemId])
    .filter((item): item is ItemEntity => item !== undefined)
    .filter(item => item.type === 'caption')
    .sort((left, right) => left.range.startUs - right.range.startUs)
    .map(item => ({
      ...(typeof (item as { name?: string }).name === 'string'
        ? { id: (item as { name?: string }).name }
        : {}),
      startUs: item.range.startUs,
      endUs: item.range.startUs + item.range.durationUs,
      text: String(item.text ?? ''),
      ...(item.cueSettings === undefined
        ? {}
        : { settings: item.cueSettings as Readonly<Record<string, string>> }),
    }));
  const serialized = format === 'srt' ? serializeSrt(cues) : serializeWebVtt(cues);
  return {
    text: serialized.text,
    cueCount: cues.length,
    warnings: serialized.warnings,
  };
}

function clampTime(value: number): number {
  return Math.max(0, Math.floor(value));
}

function alignCueToSilence(
  cue: SubtitleCue,
  silence: readonly { readonly startUs: number; readonly durationUs: number }[],
): SubtitleCue {
  let startUs = cue.startUs;
  for (const range of silence) {
    const endUs = range.startUs + range.durationUs;
    if (range.startUs <= startUs && startUs < endUs) {
      startUs = endUs;
    }
  }
  if (startUs !== cue.startUs) {
    const shiftedEnd = startUs + (cue.endUs - cue.startUs);
    return { ...cue, startUs, endUs: shiftedEnd };
  }
  return cue;
}

/**
 * Suggest an alignment shift (in microseconds) for a cue whose start falls
 * inside a silent range, or 0 when it is already on audible audio.
 */
export function alignCueToSilenceUs(
  cue: SubtitleCue,
  silence: readonly { readonly startUs: number; readonly durationUs: number }[],
): number {
  const aligned = alignCueToSilence(cue, silence);
  return aligned.startUs - cue.startUs;
}

/** Convert an audio frame range to a microsecond range. */
export function frameRangeToUs(
  startFrame: number,
  frameCount: number,
  sampleRate: number,
): { readonly startUs: number; readonly durationUs: number } {
  const startUs = clampTime((startFrame / sampleRate) * 1_000_000);
  const durationUs = clampTime((frameCount / sampleRate) * 1_000_000);
  return { startUs, durationUs };
}
