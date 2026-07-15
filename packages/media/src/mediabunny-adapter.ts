import { throwIfAborted, type Diagnostic } from '@aelion/core';
import {
  ALL_FORMATS,
  AudioSampleSink,
  BufferSource,
  CustomSource,
  EncodedPacketSink,
  Input,
  MP4,
  WEBM,
  type EncodedPacket,
  type InputTrack,
  type InputVideoTrack,
} from 'mediabunny';

import type {
  AudioTrackInfo,
  MediaProbeOptions,
  SampleEntry,
  SampleIndex,
  TrackInfo,
  VideoTrackInfo,
  RangeReader,
} from './types.js';
import { resolveVideoSeek } from './seek.js';

const MICROSECONDS_PER_SECOND = 1_000_000;
let activeVideoDecoders = 0;
let retainedVideoFrames = 0;

export function videoDecoderResourceSnapshot(): {
  readonly activeDecoders: number;
  readonly retainedFrames: number;
} {
  return { activeDecoders: activeVideoDecoders, retainedFrames: retainedVideoFrames };
}

function secondsToUs(value: number, context: string): number {
  const microseconds = Math.round(value * MICROSECONDS_PER_SECOND);
  if (!Number.isSafeInteger(microseconds)) {
    throw new RangeError(`${context} is outside the safe microsecond range`);
  }
  return microseconds;
}

function diagnostic(code: string, message: string): Diagnostic {
  return {
    code,
    severity: 'warning',
    message,
    recoverable: true,
  };
}

function adapterLimitDiagnostics(): readonly Diagnostic[] {
  return [
    diagnostic(
      'MEDIA_RAW_DTS_UNAVAILABLE',
      'The container adapter exposes decode order and PTS, but not raw container DTS.',
    ),
    diagnostic(
      'MEDIA_SAMPLE_OFFSET_UNAVAILABLE',
      'The container adapter exposes encoded sample size, but not a stable physical byte offset.',
    ),
  ];
}

function codecFamily(codec: string | null): string {
  return codec ?? 'unknown';
}

function description(
  config: VideoDecoderConfig | AudioDecoderConfig | null,
): Uint8Array | undefined {
  const source = config?.description;
  if (source === undefined) return undefined;
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  return new Uint8Array(
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  );
}

function copyVideoDecoderConfig(config: VideoDecoderConfig): VideoDecoderConfig {
  const configDescription = description(config);
  return {
    ...config,
    ...(configDescription === undefined ? {} : { description: configDescription }),
  };
}

async function videoTrackInfo(track: InputVideoTrack): Promise<VideoTrackInfo> {
  const [codec, codecString, width, height, rotation, timeResolution, config] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getCodedWidth(),
    track.getCodedHeight(),
    track.getRotation(),
    track.getTimeResolution(),
    track.getDecoderConfig(),
  ]);
  const configDescription = description(config);
  return {
    kind: 'video',
    id: track.id,
    codec: codecString ?? codec ?? 'unknown',
    codecFamily: codecFamily(codec),
    codedWidth: width,
    codedHeight: height,
    rotation,
    timeBase: { numerator: 1, denominator: timeResolution },
    ...(configDescription === undefined ? {} : { description: configDescription }),
  };
}

async function audioTrackInfo(track: InputTrack): Promise<AudioTrackInfo> {
  if (!track.isAudioTrack()) throw new TypeError('Track is not audio');
  const [codec, codecString, sampleRate, channelCount, timeResolution, config] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getSampleRate(),
    track.getNumberOfChannels(),
    track.getTimeResolution(),
    track.getDecoderConfig(),
  ]);
  const configDescription = description(config);
  return {
    kind: 'audio',
    id: track.id,
    codec: codecString ?? codec ?? 'unknown',
    codecFamily: codecFamily(codec),
    sampleRate,
    channelCount,
    timeBase: { numerator: 1, denominator: timeResolution },
    ...(configDescription === undefined ? {} : { description: configDescription }),
  };
}

function packetEntry(
  track: InputTrack,
  packet: EncodedPacket,
  decodeOrder: number,
  normalizedDecodeTimeUs: number,
): SampleEntry {
  return {
    trackId: track.id,
    sampleIndex: decodeOrder,
    kind: track.isVideoTrack() ? 'video' : 'audio',
    decodeOrder,
    presentationOrder: -1,
    sourceSequenceNumber: packet.sequenceNumber,
    presentationTimestampUs: packet.microsecondTimestamp,
    durationUs: packet.microsecondDuration,
    // Normalize the decode timeline to zero and accumulate durations in
    // strict decode order. Raw container DTS origin remains adapter-private.
    normalizedDecodeTimeUs,
    isSync: packet.type === 'key',
    byteLength: packet.byteLength,
  };
}

function assignPresentationOrder(samples: readonly SampleEntry[]): {
  readonly samples: readonly SampleEntry[];
  readonly presentationOrder: readonly number[];
} {
  const order = samples
    .map((_, index) => index)
    .sort((left, right) => {
      const leftSample = samples[left];
      const rightSample = samples[right];
      return (
        (leftSample?.presentationTimestampUs ?? 0) - (rightSample?.presentationTimestampUs ?? 0) ||
        left - right
      );
    });
  const position = new Map(
    order.map((sampleIndex, presentationOrder) => [sampleIndex, presentationOrder]),
  );
  return {
    samples: samples.map(sample => ({
      ...sample,
      presentationOrder: position.get(sample.sampleIndex) ?? -1,
    })),
    presentationOrder: order,
  };
}

async function indexTrack(
  track: InputTrack,
  signal: AbortSignal | undefined,
): Promise<{
  readonly samples: readonly SampleEntry[];
  readonly presentationOrder: readonly number[];
}> {
  const sink = new EncodedPacketSink(track);
  const samples: SampleEntry[] = [];
  let normalizedDecodeTimeUs = 0;
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    throwIfAborted(signal, 'media sample indexing');
    samples.push(packetEntry(track, packet, samples.length, normalizedDecodeTimeUs));
    normalizedDecodeTimeUs += packet.microsecondDuration;
  }
  return assignPresentationOrder(samples);
}

export async function createSampleIndex(
  bytes: Uint8Array,
  options: MediaProbeOptions = {},
): Promise<SampleIndex> {
  throwIfAborted(options.signal, 'media probe');
  const input = new Input({
    source: new BufferSource(bytes),
    formats: ALL_FORMATS,
  });

  try {
    const [format, durationSeconds, tracks] = await Promise.all([
      input.getFormat(),
      input.computeDuration(),
      input.getTracks(),
    ]);
    throwIfAborted(options.signal, 'media probe');
    const trackInfos = await Promise.all<TrackInfo>(
      tracks.map(track => (track.isVideoTrack() ? videoTrackInfo(track) : audioTrackInfo(track))),
    );
    const diagnostics: Diagnostic[] = [...adapterLimitDiagnostics()];
    const samples: Record<number, readonly SampleEntry[]> = {};
    const presentationOrder: Record<number, readonly number[]> = {};

    if (options.includeSamples ?? true) {
      for (const track of tracks) {
        const indexed = await indexTrack(track, options.signal);
        samples[track.id] = indexed.samples;
        presentationOrder[track.id] = indexed.presentationOrder;
      }
    }

    return {
      schemaVersion: '1.0.0',
      container: format === MP4 ? 'mp4' : format === WEBM ? 'webm' : 'unknown',
      durationUs: secondsToUs(durationSeconds, 'media duration'),
      tracks: trackInfos,
      capabilities: {
        timingAndSize: true,
        rawDecodeTimestamps: false,
        byteOffsets: false,
      },
      samples,
      presentationOrder,
      diagnostics,
    };
  } finally {
    input.dispose();
  }
}

export async function createSampleIndexFromReader(
  reader: RangeReader,
  options: MediaProbeOptions = {},
): Promise<SampleIndex> {
  throwIfAborted(options.signal, 'media range probe');
  const source = new CustomSource({
    getSize: () => reader.size(options.signal),
    read: async (start, end) => {
      const result = await reader.read({ offset: start, length: end - start }, options.signal);
      return result.bytes;
    },
    maxCacheSize: 8 * 1_024 * 1_024,
    prefetchProfile: reader.kind === 'network' ? 'network' : 'fileSystem',
  });
  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const [format, durationSeconds, tracks] = await Promise.all([
      input.getFormat(),
      input.computeDuration(),
      input.getTracks(),
    ]);
    const trackInfos = await Promise.all<TrackInfo>(
      tracks.map(track => (track.isVideoTrack() ? videoTrackInfo(track) : audioTrackInfo(track))),
    );
    const samples: Record<number, readonly SampleEntry[]> = {};
    const presentationOrder: Record<number, readonly number[]> = {};
    if (options.includeSamples ?? true) {
      for (const track of tracks) {
        const indexed = await indexTrack(track, options.signal);
        samples[track.id] = indexed.samples;
        presentationOrder[track.id] = indexed.presentationOrder;
      }
    }
    return {
      schemaVersion: '1.0.0',
      container: format === MP4 ? 'mp4' : format === WEBM ? 'webm' : 'unknown',
      durationUs: secondsToUs(durationSeconds, 'media duration'),
      tracks: trackInfos,
      capabilities: {
        timingAndSize: true,
        rawDecodeTimestamps: false,
        byteOffsets: false,
      },
      samples,
      presentationOrder,
      diagnostics: adapterLimitDiagnostics(),
    };
  } finally {
    input.dispose();
  }
}

export async function probeSampleIndex(
  bytes: Uint8Array,
  options: MediaProbeOptions = {},
): Promise<
  | { readonly ok: true; readonly index: SampleIndex }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
> {
  try {
    return { ok: true, index: await createSampleIndex(bytes, options) };
  } catch (cause) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'MEDIA_INPUT_INVALID',
          severity: 'error',
          message: cause instanceof Error ? cause.message : 'Input media is unsupported or corrupt',
          recoverable: false,
          cause,
        },
      ],
    };
  }
}

export interface VideoDecodeResult {
  readonly frame: VideoFrame;
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly decodedPackets: number;
  readonly plannedPackets: number;
  readonly decodeStartUs: number;
  readonly targetUs: number;
  close(): void;
}

export interface VideoDecodeOptions {
  readonly signal?: AbortSignal;
  readonly maxDecodeQueueSize?: number;
  /** Zero-based index within the container's video tracks. */
  readonly streamIndex?: number;
  /** A caller-owned immutable index may be reused to avoid cold re-indexing on warm seeks. */
  readonly sampleIndex?: SampleIndex;
}

export interface AudioPcmBlock {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly startUs: number;
  readonly durationUs: number;
  readonly frameCount: number;
  readonly interleaved: Float32Array;
}

export interface AudioDecodeOptions {
  readonly signal?: AbortSignal;
  readonly streamIndex?: number;
}

export async function decodeAudioPcmRange(
  bytes: Uint8Array,
  startUs: number,
  durationUs: number,
  options: AudioDecodeOptions = {},
): Promise<AudioPcmBlock> {
  throwIfAborted(options.signal, 'audio PCM decode');
  if (
    !Number.isSafeInteger(startUs) ||
    !Number.isSafeInteger(durationUs) ||
    startUs < 0 ||
    durationUs <= 0
  ) {
    throw new RangeError('Audio decode range must use non-negative safe integer microseconds');
  }
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const tracks = await input.getAudioTracks();
    const track = tracks[options.streamIndex ?? 0];
    if (track === undefined) throw new RangeError('Requested audio stream does not exist');
    const sampleRate = await track.getSampleRate();
    const channelCount = await track.getNumberOfChannels();
    const frameCount = Math.ceil((durationUs * sampleRate) / MICROSECONDS_PER_SECOND);
    const output = new Float32Array(frameCount * channelCount);
    const sink = new AudioSampleSink(track);
    const endUs = startUs + durationUs;
    for await (const sample of sink.samples(
      startUs / MICROSECONDS_PER_SECOND,
      endUs / MICROSECONDS_PER_SECOND,
    )) {
      throwIfAborted(options.signal, 'audio PCM decode');
      try {
        const sampleStartFrame = Math.round(
          ((sample.microsecondTimestamp - startUs) * sampleRate) / MICROSECONDS_PER_SECOND,
        );
        const sourceOffset = Math.max(0, -sampleStartFrame);
        const destinationOffset = Math.max(0, sampleStartFrame);
        const frames = Math.min(
          sample.numberOfFrames - sourceOffset,
          frameCount - destinationOffset,
        );
        if (frames <= 0) continue;
        const copied = new Float32Array(frames * channelCount);
        sample.copyTo(copied, {
          planeIndex: 0,
          format: 'f32',
          frameOffset: sourceOffset,
          frameCount: frames,
        });
        output.set(copied, destinationOffset * channelCount);
      } finally {
        sample.close();
      }
    }
    return {
      sampleRate,
      channelCount,
      startUs,
      durationUs,
      frameCount,
      interleaved: output,
    };
  } finally {
    input.dispose();
  }
}

async function waitForDecodeCapacity(
  decoder: VideoDecoder,
  maxDecodeQueueSize: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  while (decoder.decodeQueueSize >= maxDecodeQueueSize) {
    throwIfAborted(signal, 'video exact seek');
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        decoder.removeEventListener('dequeue', onDequeue);
        reject(new DOMException('Video decode wait was aborted', 'AbortError'));
      };
      const onDequeue = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      decoder.addEventListener('dequeue', onDequeue, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export async function decodeVideoFrameAt(
  bytes: Uint8Array,
  targetUs: number,
  options: VideoDecodeOptions = {},
): Promise<VideoDecodeResult> {
  throwIfAborted(options.signal, 'video exact seek');
  if (!Number.isSafeInteger(targetUs) || targetUs < 0) {
    throw new RangeError('targetUs must be a non-negative safe integer');
  }
  if (typeof VideoDecoder !== 'function') throw new Error('VideoDecoder is unavailable');

  const index =
    options.sampleIndex ??
    (await createSampleIndex(
      bytes,
      options.signal === undefined ? {} : { signal: options.signal },
    ));
  const streamIndex = options.streamIndex ?? 0;
  if (!Number.isSafeInteger(streamIndex) || streamIndex < 0) {
    throw new RangeError('Video stream index must be a non-negative safe integer');
  }
  const videoInfo = index.tracks.filter(track => track.kind === 'video')[streamIndex];
  if (videoInfo === undefined) throw new RangeError('Requested video stream does not exist');
  const seek = resolveVideoSeek(index, videoInfo.id, targetUs);
  const targetSample = index.samples[videoInfo.id]?.[seek.presentationSample];
  const decodeStartSample = index.samples[videoInfo.id]?.[seek.decodeStartSample];
  if (targetSample === undefined || decodeStartSample === undefined) {
    throw new Error('SampleIndex returned an invalid seek plan');
  }

  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  let decoder: VideoDecoder | undefined;
  let selectedFrame: VideoFrame | undefined;
  let selectedTimestampUs = Number.MIN_SAFE_INTEGER;
  let selectedDurationUs = 0;
  let decodedPackets = 0;
  let decoderCounted = false;

  try {
    const track = (await input.getVideoTracks()).find(candidate => candidate.id === videoInfo.id);
    if (track === undefined) throw new Error('Indexed video track is missing from input');
    const config = await track.getDecoderConfig();
    if (config === null) throw new Error('Video decoder config is unavailable');
    const supported = await VideoDecoder.isConfigSupported(config);
    if (!supported.supported) {
      throw new Error(`Video decoder config is unsupported: ${videoInfo.codec}`);
    }

    let decodeFailure: DOMException | undefined;
    decoder = new VideoDecoder({
      output: frame => {
        const frameTimestamp = frame.timestamp;
        if (frameTimestamp <= targetUs && frameTimestamp >= selectedTimestampUs) {
          selectedFrame?.close();
          selectedFrame = frame;
          selectedTimestampUs = frameTimestamp;
          selectedDurationUs = frame.duration ?? 0;
        } else {
          frame.close();
        }
      },
      error: error => {
        decodeFailure = error;
      },
    });
    activeVideoDecoders += 1;
    decoderCounted = true;
    decoder.configure(copyVideoDecoderConfig(config));

    const sink = new EncodedPacketSink(track);
    const startPacket = await sink.getKeyPacket(targetUs / MICROSECONDS_PER_SECOND, {
      verifyKeyPackets: true,
    });
    if (startPacket === null) throw new Error('No sync packet exists at or before target');
    if (startPacket.sequenceNumber !== decodeStartSample.sourceSequenceNumber) {
      throw new Error('SampleIndex sync point differs from verified container sync packet');
    }

    const maxDecodeQueueSize = options.maxDecodeQueueSize ?? 16;
    if (!Number.isSafeInteger(maxDecodeQueueSize) || maxDecodeQueueSize <= 0) {
      throw new RangeError('maxDecodeQueueSize must be a positive safe integer');
    }
    for await (const packet of sink.packets(startPacket)) {
      throwIfAborted(options.signal, 'video exact seek');
      await waitForDecodeCapacity(decoder, maxDecodeQueueSize, options.signal);
      decoder.decode(packet.toEncodedVideoChunk());
      decodedPackets += 1;
      if (packet.sequenceNumber === targetSample.sourceSequenceNumber) break;
    }
    await decoder.flush();
    if (decodeFailure !== undefined) throw decodeFailure;
    if (
      selectedFrame === undefined ||
      selectedTimestampUs !== targetSample.presentationTimestampUs
    ) {
      throw new Error(
        `Exact seek expected PTS ${targetSample.presentationTimestampUs}, received ${selectedTimestampUs}`,
      );
    }

    let closed = false;
    const frame = selectedFrame;
    retainedVideoFrames += 1;
    return {
      frame,
      timestampUs: selectedTimestampUs,
      durationUs: selectedDurationUs,
      decodedPackets,
      plannedPackets: seek.samplesToDecode,
      decodeStartUs: seek.decodeStartUs,
      targetUs,
      close: () => {
        if (closed) return;
        closed = true;
        frame.close();
        retainedVideoFrames -= 1;
      },
    };
  } catch (error) {
    selectedFrame?.close();
    throw error;
  } finally {
    decoder?.close();
    if (decoderCounted) activeVideoDecoders -= 1;
    input.dispose();
  }
}
