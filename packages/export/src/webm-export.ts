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
  type StreamTargetChunk,
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
  /**
   * Configuration submitted to the encoders. Variable bitrate targets are not
   * promises about the measured bitrate of the resulting media.
   */
  readonly encoderConfiguration: MuxedEncoderConfiguration;
}

export interface MuxedEncoderConfiguration {
  readonly profile: 'webm-vp9-opus' | 'mp4-h264-aac';
  readonly video: {
    readonly codec: string;
    readonly codecString: string;
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    readonly bitrateMode: 'variable';
    readonly targetBitrate: number;
  };
  readonly audio: {
    readonly codec: string;
    readonly sampleRate: number;
    readonly channelCount: number;
    readonly bitrateMode: 'variable';
    readonly targetBitrate: number;
  };
}

export type Mp4ExportOptions = WebMExportOptions;
export type Mp4ExportResult = WebMExportResult;

interface MuxedExportProfile {
  readonly id: MuxedEncoderConfiguration['profile'];
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

interface SinkCompletionBarrier {
  readonly writable: WritableStream<StreamTargetChunk>;
  readonly completion: Promise<void>;
  abort(reason: unknown): void;
}

function createSinkCompletionBarrier(
  sink: WritableStream<StreamTargetChunk>,
): SinkCompletionBarrier {
  const stream = new TransformStream<StreamTargetChunk, StreamTargetChunk>();
  const controller = new AbortController();
  const completion = stream.readable.pipeTo(sink, { signal: controller.signal });
  // The muxer may report a sink failure through its own writer before the
  // pipe promise is awaited. Keep that rejection observed in the meantime.
  void completion.catch(() => undefined);
  return {
    writable: stream.writable,
    completion,
    abort: reason => controller.abort(reason),
  };
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

  // StreamTarget closes its writer during Output.finalize(). Some Firefox
  // builds have resolved that close before the consumer sink's close callback
  // became observable. Pipe through a barrier and await the pipe separately so
  // a completed export always means the caller's sink is fully closed.
  const sinkBarrier = createSinkCompletionBarrier(options.sink);
  let output: Output | undefined;
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
    const target = new StreamTarget(sinkBarrier.writable, {
      chunked: true,
      chunkSize: 64 * 1_024,
    });
    output = new Output({
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
    await sinkBarrier.completion;
    options.onProgress?.(1);
    return {
      mimeType: await output.getMimeType(),
      videoFrames,
      audioFrames,
      durationUs: options.durationUs,
      encoderConfiguration: {
        profile: profile.id,
        video: {
          codec: profile.videoCodec,
          codecString: profile.fullVideoCodecString,
          width: options.width,
          height: options.height,
          frameRate: options.frameRate.numerator / options.frameRate.denominator,
          bitrateMode: 'variable',
          targetBitrate: options.videoBitrate,
        },
        audio: {
          codec: profile.audioCodec,
          sampleRate: options.sampleRate,
          channelCount: options.channelCount,
          bitrateMode: 'variable',
          targetBitrate: options.audioBitrate,
        },
      },
    };
  } catch (error) {
    if (output !== undefined && output.state !== 'finalized' && output.state !== 'canceled') {
      try {
        await output.cancel();
      } catch {
        // Preserve the first failure. Stream cancellation is best-effort cleanup.
      }
    }
    sinkBarrier.abort(error);
    await sinkBarrier.completion.catch(() => undefined);
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
    id: 'webm-vp9-opus',
    operationName: 'WebM export',
    format: new WebMOutputFormat(),
    videoCodec: 'vp9',
    fullVideoCodecString: 'vp09.00.10.08',
    audioCodec: 'opus',
  });
}

export function exportMp4(options: Mp4ExportOptions): Promise<Mp4ExportResult> {
  return exportMuxed(options, {
    id: 'mp4-h264-aac',
    operationName: 'MP4 export',
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    videoCodec: 'avc',
    fullVideoCodecString: 'avc1.640028',
    audioCodec: 'aac',
  });
}
