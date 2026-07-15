import {
  AelionError,
  frameDurationUs,
  frameStartUs,
  throwIfAborted,
  type Rational,
} from '@aelion/core';
import {
  AudioSample,
  AudioSampleSource,
  Output,
  Mp4OutputFormat,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny';

export interface OfflineFrameRequest {
  readonly frameIndex: number;
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly width: number;
  readonly height: number;
}

export interface OfflineAudioRequest {
  readonly startFrame: number;
  readonly frameCount: number;
  readonly sampleRate: number;
  readonly channelCount: number;
}

export interface WebMExportOptions {
  readonly durationUs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: Rational;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly videoBitrate: number;
  readonly audioBitrate: number;
  readonly sink: WritableStream<{
    readonly type: 'write';
    readonly data: Uint8Array<ArrayBuffer>;
    readonly position: number;
  }>;
  /** Idempotent sink-specific cleanup (for example deleting a partial OPFS file). */
  readonly cleanupSink?: (reason: unknown) => void | Promise<void>;
  readonly renderFrame: (request: OfflineFrameRequest, signal?: AbortSignal) => Promise<VideoFrame>;
  readonly renderAudio: (
    request: OfflineAudioRequest,
    signal?: AbortSignal,
  ) => Promise<Float32Array>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}

export interface WebMExportResult {
  readonly mimeType: string;
  readonly videoFrames: number;
  readonly audioFrames: number;
  readonly durationUs: number;
}

export type Mp4ExportOptions = WebMExportOptions;
export type Mp4ExportResult = WebMExportResult;

interface MuxedExportProfile {
  readonly operationName: string;
  readonly format: WebMOutputFormat | Mp4OutputFormat;
  readonly videoCodec: 'vp9' | 'avc';
  readonly fullVideoCodecString: string;
  readonly audioCodec: 'opus' | 'aac';
}

type ExportStage =
  | 'initialize'
  | 'render-video'
  | 'encode-video'
  | 'render-audio'
  | 'encode-audio'
  | 'finalize';

const MAIN_THREAD_YIELD_INTERVAL_MS = 16;

function nextMainThreadTask(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, 0));
}

function exportFailure(stage: ExportStage, cause: unknown): AelionError {
  const causeName = cause instanceof DOMException ? cause.name : '';
  const causeMessage = cause instanceof Error ? cause.message : '';
  if (
    causeName === 'QuotaExceededError' ||
    /quota|storage|disk|write failed/iu.test(causeMessage)
  ) {
    return new AelionError([
      {
        code: 'EXPORT_STORAGE_WRITE_FAILED',
        severity: 'error',
        message: `Export sink write failed: ${causeMessage || 'unknown storage failure'}`,
        recoverable: true,
        cause,
      },
    ]);
  }
  const mapping: Record<ExportStage, readonly [string, string]> = {
    initialize: ['EXPORT_ENCODER_INIT_FAILED', 'Failed to initialize export encoders or muxer'],
    'render-video': ['EXPORT_VIDEO_RENDER_FAILED', 'Failed to render an export video frame'],
    'encode-video': ['EXPORT_VIDEO_ENCODER_FAILED', 'Video encoder rejected an export frame'],
    'render-audio': ['EXPORT_AUDIO_RENDER_FAILED', 'Failed to render an export PCM block'],
    'encode-audio': ['EXPORT_AUDIO_ENCODER_FAILED', 'Audio encoder rejected an export block'],
    finalize: ['EXPORT_MUX_OR_SINK_FAILED', 'Failed to finalize muxed output or write the sink'],
  };
  const [code, prefix] = mapping[stage];
  return new AelionError([
    {
      code,
      severity: 'error',
      message: `${prefix}: ${cause instanceof Error ? cause.message : 'unknown failure'}`,
      recoverable: stage === 'finalize',
      cause,
    },
  ]);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

async function exportMuxed(
  options: WebMExportOptions,
  profile: MuxedExportProfile,
): Promise<WebMExportResult> {
  assertPositiveInteger(options.durationUs, 'durationUs');
  assertPositiveInteger(options.width, 'width');
  assertPositiveInteger(options.height, 'height');
  assertPositiveInteger(options.sampleRate, 'sampleRate');
  assertPositiveInteger(options.channelCount, 'channelCount');
  throwIfAborted(options.signal, profile.operationName);

  const target = new StreamTarget(options.sink, {
    chunked: true,
    chunkSize: 64 * 1_024,
  });
  const output = new Output({
    format: profile.format,
    target,
  });
  const videoSource = new VideoSampleSource({
    codec: profile.videoCodec,
    fullCodecString: profile.fullVideoCodecString,
    bitrate: options.videoBitrate,
    bitrateMode: 'variable',
    keyFrameInterval: 1,
    latencyMode: 'quality',
    alpha: 'discard',
  });
  const audioSource = new AudioSampleSource({
    codec: profile.audioCodec,
    bitrate: options.audioBitrate,
    bitrateMode: 'variable',
  });
  output.addVideoTrack(videoSource, {
    frameRate: options.frameRate.numerator / options.frameRate.denominator,
  });
  output.addAudioTrack(audioSource);

  let videoFrames = 0;
  let audioFrames = 0;
  let stage: ExportStage = 'initialize';
  let lastMainThreadYieldMs = performance.now();
  const yieldMainThreadWhenDue = async (): Promise<void> => {
    throwIfAborted(options.signal, 'WebM export');
    if (performance.now() - lastMainThreadYieldMs < MAIN_THREAD_YIELD_INTERVAL_MS) return;
    await nextMainThreadTask();
    lastMainThreadYieldMs = performance.now();
    throwIfAborted(options.signal, 'WebM export');
  };
  try {
    await output.start();
    await yieldMainThreadWhenDue();
    const frameCount = Math.ceil(
      (options.durationUs * options.frameRate.numerator) /
        (1_000_000 * options.frameRate.denominator),
    );
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(options.signal, 'WebM video export');
      const timestampUs = frameStartUs(frameIndex, options.frameRate);
      const durationUs = Math.min(
        frameDurationUs(frameIndex, options.frameRate),
        options.durationUs - timestampUs,
      );
      if (durationUs <= 0) break;
      stage = 'render-video';
      const frame = await options.renderFrame(
        { frameIndex, timestampUs, durationUs, width: options.width, height: options.height },
        options.signal,
      );
      try {
        stage = 'encode-video';
        const sample = new VideoSample(frame, {
          timestamp: timestampUs / 1_000_000,
          duration: durationUs / 1_000_000,
        });
        try {
          await videoSource.add(sample);
        } finally {
          sample.close();
        }
      } finally {
        frame.close();
      }
      videoFrames += 1;
      options.onProgress?.((timestampUs + durationUs) / options.durationUs / 2);
      await yieldMainThreadWhenDue();
    }
    videoSource.close();

    const totalAudioFrames = Math.floor((options.durationUs * options.sampleRate) / 1_000_000);
    const blockFrames = 1_024;
    while (audioFrames < totalAudioFrames) {
      throwIfAborted(options.signal, 'WebM audio export');
      const frameCount = Math.min(blockFrames, totalAudioFrames - audioFrames);
      stage = 'render-audio';
      const pcm = await options.renderAudio(
        {
          startFrame: audioFrames,
          frameCount,
          sampleRate: options.sampleRate,
          channelCount: options.channelCount,
        },
        options.signal,
      );
      if (pcm.length !== frameCount * options.channelCount) {
        throw new RangeError('renderAudio returned an unexpected interleaved PCM length');
      }
      const sample = new AudioSample({
        data: pcm,
        format: 'f32',
        numberOfChannels: options.channelCount,
        sampleRate: options.sampleRate,
        timestamp: audioFrames / options.sampleRate,
      });
      try {
        stage = 'encode-audio';
        await audioSource.add(sample);
      } finally {
        sample.close();
      }
      audioFrames += frameCount;
      options.onProgress?.(Math.min(1 - Number.EPSILON, 0.5 + audioFrames / totalAudioFrames / 2));
      await yieldMainThreadWhenDue();
    }
    audioSource.close();
    stage = 'finalize';
    await output.finalize();
    options.onProgress?.(1);
    return {
      mimeType: await output.getMimeType(),
      videoFrames,
      audioFrames,
      durationUs: options.durationUs,
    };
  } catch (error) {
    try {
      await output.cancel();
    } catch {
      // Preserve the first failure. Stream cancellation is best-effort cleanup.
    }
    try {
      await options.cleanupSink?.(error);
    } catch {
      // Cleanup errors are reported by the concrete sink; preserve the primary failure.
    }
    if (error instanceof AelionError) throw error;
    throw exportFailure(stage, error);
  }
}

export function exportWebM(options: WebMExportOptions): Promise<WebMExportResult> {
  return exportMuxed(options, {
    operationName: 'WebM export',
    format: new WebMOutputFormat(),
    videoCodec: 'vp9',
    fullVideoCodecString: 'vp09.00.10.08',
    audioCodec: 'opus',
  });
}

export function exportMp4(options: Mp4ExportOptions): Promise<Mp4ExportResult> {
  return exportMuxed(options, {
    operationName: 'MP4 export',
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    videoCodec: 'avc',
    fullVideoCodecString: 'avc1.640028',
    audioCodec: 'aac',
  });
}
