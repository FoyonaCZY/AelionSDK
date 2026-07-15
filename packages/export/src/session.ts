import { AelionError, type Diagnostic, type JsonValue } from '@aelion/core';
import type { RenderIr } from '@aelion/render-ir';

import { exportWebM, type WebMExportOptions, type WebMExportResult } from './webm-export.js';

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
}

function channelCount(layout: string): number | undefined {
  if (layout === 'mono') return 1;
  if (layout === 'stereo') return 2;
  if (layout === '5.1') return 6;
  return undefined;
}

export async function preflightWebMExport(
  options: FrozenWebMExportOptions,
): Promise<ExportPreflightReport> {
  const issues: ExportPreflightIssue[] = [];
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
    codec: 'vp09.00.10.08',
    width: options.ir.width,
    height: options.ir.height,
    bitrate: options.videoBitrate,
    framerate: options.ir.frameRate.numerator / options.ir.frameRate.denominator,
  };
  const audioConfig: AudioEncoderConfig = {
    codec: 'opus',
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
      message: 'VP9 export config is unsupported',
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
  } else if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported) {
    issues.push({
      code: 'EXPORT_AUDIO_CONFIG_UNSUPPORTED',
      severity: 'error',
      message: 'Opus export config is unsupported',
      recoverable: false,
    });
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

export async function exportFrozenRenderIrWebM(
  options: FrozenWebMExportOptions,
): Promise<WebMExportResult> {
  const report = await preflightWebMExport(options);
  if (!report.ok) {
    throw new AelionError(report.issues);
  }
  return exportWebM({
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
  });
}
