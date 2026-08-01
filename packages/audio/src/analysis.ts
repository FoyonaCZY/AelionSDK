import { throwIfAborted } from '@aelionsdk/core';

/** A bounded PCM source for offline analysis, mirroring the waveform readFrames contract. */
export interface AnalysisSource {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly totalFrames: number;
  readonly readFrames: (
    startFrame: number,
    frameCount: number,
    signal?: AbortSignal,
  ) => Promise<Float32Array>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}

/** A single detected beat. */
export interface BeatMarker {
  /** Beat start frame. */
  readonly frame: number;
  /** Frame-based duration (estimated from the analysis window). */
  readonly frameCount: number;
  /** Normalized beat strength, 0..1. */
  readonly strength: number;
}

/** Result of beat detection over a PCM source. */
export interface BeatDetectionResult {
  readonly sampleRate: number;
  readonly totalFrames: number;
  readonly beats: readonly BeatMarker[];
}

/** A single detected scene boundary. */
export interface SceneBoundary {
  /** Frame where the scene change is detected. */
  readonly frame: number;
  /** Normalized change magnitude, 0..1. */
  readonly magnitude: number;
}

/** Result of scene-boundary detection over a PCM source. */
export interface SceneDetectionResult {
  readonly sampleRate: number;
  readonly totalFrames: number;
  readonly scenes: readonly SceneBoundary[];
}

const MIN_CHANGE_DB = 6;

/**
 * Detect beats from an interleaved PCM source using a bounded energy-envelope
 * onset detector. The signal is processed in fixed windows, computing a local
 * RMS envelope; an onset is flagged where the envelope rises above the local
 * noise floor by `minimumOnsetDb`. Bounded memory: only the current window and
 * a rolling floor are retained.
 */
export async function detectBeats(
  options: AnalysisSource & { readonly minimumOnsetDb?: number },
): Promise<BeatDetectionResult> {
  const sampleRate = options.sampleRate;
  const channelCount = options.channelCount;
  const totalFrames = options.totalFrames;
  const minimumOnsetDb = options.minimumOnsetDb ?? MIN_CHANGE_DB;
  const windowFrames = Math.max(1, Math.round(sampleRate / 20));
  const beats: BeatMarker[] = [];
  let previousDb = 0;
  let floor = 0;
  let lastBeatFrame = -windowFrames;
  for (let startFrame = 0; startFrame < totalFrames; startFrame += windowFrames) {
    throwIfAborted(options.signal, 'Beat detection');
    const frameCount = Math.min(windowFrames, totalFrames - startFrame);
    const pcm = await options.readFrames(startFrame, frameCount, options.signal);
    if (pcm.length !== frameCount * channelCount) {
      throw new RangeError('Beat source returned an unexpected PCM length');
    }
    let squares = 0;
    for (const sample of pcm) squares += sample * sample;
    const envelope = Math.sqrt(squares / Math.max(1, frameCount * channelCount));
    const db = 20 * Math.log10(Math.max(1e-9, envelope));
    floor = floor === 0 ? db : Math.max(-120, floor * 0.95 + db * 0.05);
    const onset = db - floor > minimumOnsetDb && db > previousDb;
    if (onset && startFrame - lastBeatFrame >= windowFrames) {
      const strength = Math.min(1, Math.max(0, (db - floor) / 24));
      beats.push({ frame: startFrame, frameCount: windowFrames, strength });
      lastBeatFrame = startFrame;
    }
    previousDb = db;
    options.onProgress?.((startFrame + frameCount) / totalFrames);
  }
  return { sampleRate, totalFrames, beats };
}

/**
 * Detect scene boundaries as audio-energy discontinuities. A scene change in
 * video is usually accompanied by an abrupt change in the audio envelope, so a
 * large window-to-window energy jump is reported as a candidate boundary.
 * This is a deterministic, media-agnostic approximation driven by the same
 * readFrames source; it does not inspect video pixels.
 */
export async function detectScenes(
  options: AnalysisSource & { readonly minimumJumpDb?: number },
): Promise<SceneDetectionResult> {
  const sampleRate = options.sampleRate;
  const channelCount = options.channelCount;
  const totalFrames = options.totalFrames;
  const minimumJumpDb = options.minimumJumpDb ?? MIN_CHANGE_DB;
  const windowFrames = Math.max(1, Math.round(sampleRate / 10));
  const scenes: SceneBoundary[] = [];
  let previousDb = 0;
  for (let startFrame = 0; startFrame < totalFrames; startFrame += windowFrames) {
    throwIfAborted(options.signal, 'Scene detection');
    const frameCount = Math.min(windowFrames, totalFrames - startFrame);
    const pcm = await options.readFrames(startFrame, frameCount, options.signal);
    if (pcm.length !== frameCount * channelCount) {
      throw new RangeError('Scene source returned an unexpected PCM length');
    }
    let squares = 0;
    for (const sample of pcm) squares += sample * sample;
    const envelope = Math.sqrt(squares / Math.max(1, frameCount * channelCount));
    const db = 20 * Math.log10(Math.max(1e-9, envelope));
    if (startFrame > 0) {
      const jump = Math.abs(db - previousDb);
      if (jump >= minimumJumpDb) {
        scenes.push({ frame: startFrame, magnitude: Math.min(1, jump / 24) });
      }
    }
    previousDb = db;
    options.onProgress?.((startFrame + frameCount) / totalFrames);
  }
  return { sampleRate, totalFrames, scenes };
}
