import { AelionError, type Diagnostic, type JsonValue } from '@aelion/core';
import {
  LOCAL_RGBA8_COLOR_CAPABILITY,
  preflightColorPipeline,
  type RenderIr,
} from '@aelion/render-ir';

import {
  exportMp4,
  exportWebM,
  type Mp4ExportResult,
  type WebMExportOptions,
  type WebMExportResult,
} from './webm-export.js';
import { exportMuxedInWorker } from './worker-export.js';
import type { ExportProfileId } from './profiles.js';

export type ExportPreflightIssue = Diagnostic;

export interface ExportPreflightReport {
  readonly ok: boolean;
  readonly revision: bigint;
  readonly issues: readonly ExportPreflightIssue[];
}

export interface FrozenWebMExportOptions
  extends Omit<
    WebMExportOptions,
    'durationUs' | 'width' | 'height' | 'frameRate' | 'sampleRate' | 'channelCount'
  > {
  readonly ir: RenderIr;
  readonly projectRevision: bigint;
  readonly materialBackendAvailable?: (
    materialId: string,
    parameters: Readonly<Record<string, JsonValue>>,
  ) => boolean;
  /**
   * WebM defaults to Worker. MP4 defaults to inline because current Chromium
   * advertises AAC in DedicatedWorker but fails during encode; `worker` remains opt-in.
   */
  readonly execution?: 'worker' | 'inline';
}

export type FrozenMp4ExportOptions = FrozenWebMExportOptions;

export interface FrozenProfilePreflightOptions {
  readonly ir: RenderIr;
  readonly projectRevision: bigint;
  readonly profile: ExportProfileId;
  readonly sink: WebMExportOptions['sink'];
  readonly videoBitrate?: number;
  readonly audioBitrate?: number;
  readonly materialBackendAvailable?: FrozenWebMExportOptions['materialBackendAvailable'];
}

interface MuxedPreflightProfile {
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly videoName: string;
  readonly audioName: string;
  readonly verifyAudioRuntime?: boolean;
}

const audioRuntimeSupport = new Map<string, Promise<boolean>>();

function verifyAudioEncoderRuntime(config: AudioEncoderConfig): Promise<boolean> {
  const key = JSON.stringify(config);
  const existing = audioRuntimeSupport.get(key);
  if (existing !== undefined) return existing;
  const probe = new Promise<boolean>(resolve => {
    let settled = false;
    let encoder: AudioEncoder | undefined;
    const finish = (supported: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        encoder?.close();
      } catch {
        // A codec error can close the encoder before the error callback runs.
      }
      resolve(supported);
    };
    try {
      encoder = new AudioEncoder({
        output: () => undefined,
        error: () => finish(false),
      });
      encoder.configure(config);
      const frameCount = 1_024;
      const audio = new AudioData({
        format: 'f32',
        sampleRate: config.sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: config.numberOfChannels,
        timestamp: 0,
        data: new Float32Array(frameCount * config.numberOfChannels),
      });
      try {
        encoder.encode(audio);
      } finally {
        audio.close();
      }
      void encoder.flush().then(
        () => finish(true),
        () => finish(false),
      );
    } catch {
      finish(false);
    }
  });
  audioRuntimeSupport.set(key, probe);
  return probe;
}

function channelCount(layout: string): number | undefined {
  if (layout === 'mono') return 1;
  if (layout === 'stereo') return 2;
  if (layout === '5.1') return 6;
  return undefined;
}

async function preflightMuxedExport(
  options: FrozenWebMExportOptions,
  profile: MuxedPreflightProfile,
): Promise<ExportPreflightReport> {
  const issues: ExportPreflightIssue[] = [];
  try {
    issues.push(...preflightColorPipeline(options.ir, LOCAL_RGBA8_COLOR_CAPABILITY).issues);
  } catch (error) {
    issues.push({
      code: 'COLOR_PIPELINE_CONTRACT_INVALID',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Invalid color pipeline contract',
      recoverable: false,
    });
  }
  if (options.projectRevision !== options.ir.revision) {
    issues.push({
      code: 'EXPORT_REVISION_MISMATCH',
      severity: 'error',
      message: `Project revision ${options.projectRevision.toString()} does not match frozen Render IR revision ${options.ir.revision.toString()}`,
      recoverable: false,
    });
  }
  if (channelCount(options.ir.channelLayout) === undefined) {
    issues.push({
      code: 'EXPORT_CHANNEL_LAYOUT_UNSUPPORTED',
      severity: 'error',
      message: options.ir.channelLayout,
      recoverable: false,
    });
  }
  if (options.sink.locked) {
    issues.push({
      code: 'EXPORT_SINK_LOCKED',
      severity: 'error',
      message: 'Export sink is already locked by another writer',
      recoverable: true,
    });
  }
  const videoConfig: VideoEncoderConfig = {
    codec: profile.videoCodec,
    width: options.ir.width,
    height: options.ir.height,
    bitrate: options.videoBitrate,
    framerate: options.ir.frameRate.numerator / options.ir.frameRate.denominator,
  };
  const audioConfig: AudioEncoderConfig = {
    codec: profile.audioCodec,
    sampleRate: options.ir.sampleRate,
    numberOfChannels: channelCount(options.ir.channelLayout) ?? 0,
    bitrate: options.audioBitrate,
  };
  if (typeof VideoEncoder !== 'function') {
    issues.push({
      code: 'EXPORT_VIDEO_ENCODER_UNAVAILABLE',
      severity: 'error',
      message: 'VideoEncoder is unavailable',
      recoverable: false,
    });
  } else if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported) {
    issues.push({
      code: 'EXPORT_VIDEO_CONFIG_UNSUPPORTED',
      severity: 'error',
      message: `${profile.videoName} export config is unsupported`,
      recoverable: false,
    });
  }
  if (typeof AudioEncoder !== 'function') {
    issues.push({
      code: 'EXPORT_AUDIO_ENCODER_UNAVAILABLE',
      severity: 'error',
      message: 'AudioEncoder is unavailable',
      recoverable: false,
    });
  } else {
    const declaredSupported = (await AudioEncoder.isConfigSupported(audioConfig)).supported;
    const runtimeSupported =
      declaredSupported && profile.verifyAudioRuntime === true
        ? await verifyAudioEncoderRuntime(audioConfig)
        : declaredSupported;
    if (!runtimeSupported) {
      issues.push({
        code: 'EXPORT_AUDIO_CONFIG_UNSUPPORTED',
        severity: 'error',
        message: `${profile.audioName} export config is unsupported at runtime`,
        recoverable: false,
      });
    }
  }
  for (const material of Object.values(options.ir.materials)) {
    if (!material.enabled) continue;
    const available =
      material.program !== undefined &&
      (options.materialBackendAvailable?.(material.id, material.parameters) ?? true);
    if (!available) {
      issues.push({
        code: 'EXPORT_MATERIAL_BACKEND_UNAVAILABLE',
        severity: 'error',
        message: `Material ${material.id} has no offline backend`,
        recoverable: false,
      });
    }
  }
  return { ok: issues.length === 0, revision: options.ir.revision, issues };
}

export function preflightWebMExport(
  options: FrozenWebMExportOptions,
): Promise<ExportPreflightReport> {
  return preflightMuxedExport(options, {
    videoCodec: 'vp09.00.10.08',
    audioCodec: 'opus',
    videoName: 'VP9',
    audioName: 'Opus',
  });
}

export function preflightMp4Export(
  options: FrozenMp4ExportOptions,
): Promise<ExportPreflightReport> {
  return preflightMuxedExport(options, {
    videoCodec: 'avc1.640028',
    audioCodec: 'mp4a.40.2',
    videoName: 'H.264',
    audioName: 'AAC',
    verifyAudioRuntime: true,
  });
}

/** Profile-wide preflight used by the SDK before any sink writer is acquired. */
export async function preflightProfileExport(
  options: FrozenProfilePreflightOptions,
): Promise<ExportPreflightReport> {
  if (options.profile === 'webm-vp9-opus' || options.profile === 'mp4-h264-aac') {
    const muxed = {
      ir: options.ir,
      projectRevision: options.projectRevision,
      videoBitrate: options.videoBitrate ?? 8_000_000,
      audioBitrate: options.audioBitrate ?? 192_000,
      sink: options.sink,
      renderFrame: () => Promise.reject(new Error('Preflight does not render frames')),
      renderAudio: () => Promise.reject(new Error('Preflight does not render audio')),
      ...(options.materialBackendAvailable === undefined
        ? {}
        : { materialBackendAvailable: options.materialBackendAvailable }),
    } satisfies FrozenWebMExportOptions;
    return options.profile === 'mp4-h264-aac'
      ? preflightMp4Export(muxed)
      : preflightWebMExport(muxed);
  }

  const issues: ExportPreflightIssue[] = [];
  try {
    issues.push(...preflightColorPipeline(options.ir, LOCAL_RGBA8_COLOR_CAPABILITY).issues);
  } catch (error) {
    issues.push({
      code: 'COLOR_PIPELINE_CONTRACT_INVALID',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Invalid color pipeline contract',
      recoverable: false,
    });
  }
  if (options.projectRevision !== options.ir.revision) {
    issues.push({
      code: 'EXPORT_REVISION_MISMATCH',
      severity: 'error',
      message: `Project revision ${options.projectRevision.toString()} does not match frozen Render IR revision ${options.ir.revision.toString()}`,
      recoverable: false,
    });
  }
  if (options.sink.locked) {
    issues.push({
      code: 'EXPORT_SINK_LOCKED',
      severity: 'error',
      message: 'Export sink is already locked by another writer',
      recoverable: true,
    });
  }
  if (
    (options.profile === 'still-png' ||
      options.profile === 'still-jpeg' ||
      options.profile === 'still-webp' ||
      options.profile === 'animated-gif') &&
    typeof OffscreenCanvas !== 'function'
  ) {
    issues.push({
      code: 'EXPORT_IMAGE_CANVAS_UNAVAILABLE',
      severity: 'error',
      message: 'OffscreenCanvas is unavailable for image export',
      recoverable: false,
    });
  }
  if (options.profile !== 'audio-wav') {
    for (const material of Object.values(options.ir.materials)) {
      if (!material.enabled) continue;
      const available =
        material.program !== undefined &&
        (options.materialBackendAvailable?.(material.id, material.parameters) ?? true);
      if (!available) {
        issues.push({
          code: 'EXPORT_MATERIAL_BACKEND_UNAVAILABLE',
          severity: 'error',
          message: `Material ${material.id} has no offline backend`,
          recoverable: false,
        });
      }
    }
  }
  return { ok: issues.length === 0, revision: options.ir.revision, issues };
}

export async function exportFrozenRenderIrWebM(
  options: FrozenWebMExportOptions,
): Promise<WebMExportResult> {
  const report = await preflightWebMExport(options);
  if (!report.ok) {
    throw new AelionError(report.issues);
  }
  const exportOptions: WebMExportOptions = {
    durationUs: options.ir.durationUs,
    width: options.ir.width,
    height: options.ir.height,
    frameRate: options.ir.frameRate,
    sampleRate: options.ir.sampleRate,
    channelCount: channelCount(options.ir.channelLayout) ?? 0,
    videoBitrate: options.videoBitrate,
    audioBitrate: options.audioBitrate,
    sink: options.sink,
    ...(options.cleanupSink === undefined ? {} : { cleanupSink: options.cleanupSink }),
    renderFrame: options.renderFrame,
    renderAudio: options.renderAudio,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };
  return options.execution === 'inline'
    ? exportWebM(exportOptions)
    : exportMuxedInWorker({ ...exportOptions, profile: 'webm' });
}

export async function exportFrozenRenderIrMp4(
  options: FrozenMp4ExportOptions,
): Promise<Mp4ExportResult> {
  const report = await preflightMp4Export(options);
  if (!report.ok) throw new AelionError(report.issues);
  const exportOptions: WebMExportOptions = {
    durationUs: options.ir.durationUs,
    width: options.ir.width,
    height: options.ir.height,
    frameRate: options.ir.frameRate,
    sampleRate: options.ir.sampleRate,
    channelCount: channelCount(options.ir.channelLayout) ?? 0,
    videoBitrate: options.videoBitrate,
    audioBitrate: options.audioBitrate,
    sink: options.sink,
    ...(options.cleanupSink === undefined ? {} : { cleanupSink: options.cleanupSink }),
    renderFrame: options.renderFrame,
    renderAudio: options.renderAudio,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  };
  return options.execution === 'worker'
    ? exportMuxedInWorker({ ...exportOptions, profile: 'mp4' })
    : exportMp4(exportOptions);
}
