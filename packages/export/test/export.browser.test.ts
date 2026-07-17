import { describe, expect, it } from 'vitest';
import type { StreamTargetChunk } from 'mediabunny';

import { createSampleIndex, decodeVideoFrameAt } from '@aelion/media';
import type { RenderIr } from '@aelion/render-ir';

import {
  exportGif,
  exportFrozenRenderIrMp4,
  exportFrozenRenderIrWebM,
  exportStillImage,
  exportWebM,
  OpfsSeekableSink,
  preflightMp4Export,
  preflightWebMExport,
  SeekableMemorySink,
} from '../src/index.js';

function frozenIr(revision = 7n): RenderIr {
  return {
    irVersion: '1.0.0',
    projectId: 'export-project',
    sequenceId: 'sequence',
    revision,
    width: 160,
    height: 90,
    frameRate: { numerator: 30, denominator: 1 },
    sampleRate: 48_000,
    channelLayout: 'stereo',
    workingColorSpace: 'srgb-linear',
    durationUs: 200_000,
    tracks: [],
    transitions: [],
    materials: {},
  };
}

describe('offline WebCodecs + streaming WebM export', () => {
  it('exports still PNG and bounded-frame animated GIF profiles', async () => {
    const renderFrame = (request: {
      readonly timestampUs: number;
      readonly durationUs: number;
      readonly width: number;
      readonly height: number;
    }) => {
      const canvas = new OffscreenCanvas(request.width, request.height);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('2D context unavailable');
      context.fillStyle = request.timestampUs === 0 ? 'red' : 'blue';
      context.fillRect(0, 0, request.width, request.height);
      return Promise.resolve(
        new VideoFrame(canvas, {
          timestamp: request.timestampUs,
          duration: request.durationUs,
        }),
      );
    };
    const stillSink = new SeekableMemorySink();
    const still = await exportStillImage({
      timeUs: 0,
      width: 16,
      height: 8,
      format: 'png',
      sink: stillSink.writable,
      renderFrame,
    });
    const png = stillSink.finalize();
    expect(still.mimeType).toBe('image/png');
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const gifSink = new SeekableMemorySink();
    const gif = await exportGif({
      durationUs: 200_000,
      width: 16,
      height: 8,
      frameRate: { numerator: 10, denominator: 1 },
      sink: gifSink.writable,
      renderFrame,
    });
    const bytes = gifSink.finalize();
    expect(gif).toMatchObject({ mimeType: 'image/gif', videoFrames: 2 });
    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
    expect(gifSink.snapshot().maxInFlightWrites).toBe(1);
  });

  it('capability-selects and exports MP4/H.264/AAC or reports the unsupported codec', async () => {
    const sink = new SeekableMemorySink();
    const common = {
      ir: frozenIr(),
      projectRevision: 7n,
      videoBitrate: 500_000,
      audioBitrate: 64_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: (request: { readonly timestampUs: number; readonly durationUs: number }) => {
        const canvas = new OffscreenCanvas(160, 90);
        canvas.getContext('2d')?.fillRect(0, 0, 160, 90);
        return Promise.resolve(
          new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          }),
        );
      },
      renderAudio: (request: { readonly frameCount: number; readonly channelCount: number }) =>
        Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
    } as const;
    const preflight = await preflightMp4Export(common);
    if (!preflight.ok) {
      expect(
        preflight.issues.some(issue =>
          /^EXPORT_(VIDEO|AUDIO)_CONFIG_UNSUPPORTED$/u.test(issue.code),
        ),
      ).toBe(true);
      return;
    }

    const result = await exportFrozenRenderIrMp4(common);
    const bytes = sink.finalize();
    expect(result.mimeType).toContain('video/mp4');
    expect(result.encoderConfiguration).toMatchObject({
      profile: 'mp4-h264-aac',
      video: { codec: 'avc', codecString: 'avc1.640028', targetBitrate: 500_000 },
      audio: { codec: 'aac', targetBitrate: 64_000 },
    });
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    const index = await createSampleIndex(bytes);
    expect(index.container).toBe('mp4');
    expect(index.tracks.find(track => track.kind === 'video')?.codecFamily).toBe('avc');
    expect(index.tracks.find(track => track.kind === 'audio')?.codecFamily).toBe('aac');
  });

  it('exports deterministic CFR video and sample-aligned audio with bounded writes', async () => {
    const sink = new SeekableMemorySink();
    const progress: number[] = [];
    const result = await exportWebM({
      durationUs: 1_000_000,
      width: 320,
      height: 180,
      frameRate: { numerator: 30, denominator: 1 },
      sampleRate: 48_000,
      channelCount: 2,
      videoBitrate: 1_000_000,
      audioBitrate: 96_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: request => {
        const canvas = new OffscreenCanvas(request.width, request.height);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2D context unavailable');
        const progress = request.timestampUs / 1_000_000;
        context.fillStyle = `rgb(${Math.round(progress * 255)} 64 ${Math.round((1 - progress) * 255)})`;
        context.fillRect(0, 0, request.width, request.height);
        return Promise.resolve(
          new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          }),
        );
      },
      renderAudio: request => {
        const pcm = new Float32Array(request.frameCount * request.channelCount);
        for (let frame = 0; frame < request.frameCount; frame += 1) {
          const absoluteFrame = request.startFrame + frame;
          const sample = Math.sin((absoluteFrame * 2 * Math.PI * 440) / request.sampleRate) * 0.05;
          for (let channel = 0; channel < request.channelCount; channel += 1) {
            pcm[frame * request.channelCount + channel] = sample;
          }
        }
        return Promise.resolve(pcm);
      },
      onProgress: value => progress.push(value),
    });
    const bytes = sink.finalize();

    expect(result).toMatchObject({
      videoFrames: 30,
      audioFrames: 48_000,
      durationUs: 1_000_000,
    });
    expect(result.mimeType).toContain('video/webm');
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('\u001aE\u00df\u00a3');
    expect(progress.at(-1)).toBe(1);
    expect(progress.filter(value => value === 1)).toHaveLength(1);
    expect(sink.snapshot().maxInFlightWrites).toBe(1);

    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    const audio = index.tracks.find(track => track.kind === 'audio');
    expect(index.container).toBe('webm');
    expect(index.durationUs).toBeGreaterThanOrEqual(999_000);
    expect(index.durationUs).toBeLessThanOrEqual(1_050_000);
    expect(video?.codecFamily).toBe('vp9');
    expect(audio?.codecFamily).toBe('opus');
    if (video === undefined || audio === undefined) throw new Error('Export tracks are missing');
    expect(index.samples[video.id]).toHaveLength(30);
    expect(index.samples[audio.id]?.length).toBeGreaterThan(0);
    const decoded = await decodeVideoFrameAt(bytes, 500_000);
    try {
      expect(decoded.timestampUs).toBeLessThanOrEqual(500_000);
      expect(decoded.frame.displayWidth).toBe(320);
      expect(decoded.frame.displayHeight).toBe(180);
    } finally {
      decoded.close();
    }

    Reflect.set(globalThis, '__AELION_EXPORT_EVIDENCE__', {
      bytes,
      result,
      sink: sink.snapshot(),
    });
  });

  it('does not resolve a muxed export before an asynchronous sink close completes', async () => {
    let announceClose!: () => void;
    let releaseClose!: () => void;
    const closeStarted = new Promise<void>(resolve => {
      announceClose = resolve;
    });
    const closeGate = new Promise<void>(resolve => {
      releaseClose = resolve;
    });
    const sink = new WritableStream<StreamTargetChunk>({
      write: () => undefined,
      close: async () => {
        announceClose();
        await closeGate;
      },
    });
    const result = exportFrozenRenderIrWebM({
      ir: frozenIr(),
      projectRevision: 7n,
      videoBitrate: 100_000,
      audioBitrate: 32_000,
      sink,
      renderFrame: request => {
        const canvas = new OffscreenCanvas(request.width, request.height);
        canvas.getContext('2d')?.fillRect(0, 0, request.width, request.height);
        return Promise.resolve(
          new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          }),
        );
      },
      renderAudio: request =>
        Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
    });

    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => undefined,
    );
    await closeStarted;
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseClose();
    await result;
    expect(settled).toBe(true);
  });

  it('cancels before creating encoders', async () => {
    const controller = new AbortController();
    controller.abort('test');
    const sink = new SeekableMemorySink();
    await expect(
      exportWebM({
        durationUs: 1_000_000,
        width: 320,
        height: 180,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: 1_000_000,
        audioBitrate: 96_000,
        sink: sink.writable,
        renderFrame: () => Promise.reject(new Error('must not run')),
        renderAudio: () => Promise.reject(new Error('must not run')),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
  });

  it('cancels during rendering and aborts the partial sink', async () => {
    const controller = new AbortController();
    const sink = new SeekableMemorySink();
    let renderedFrames = 0;
    await expect(
      exportWebM({
        durationUs: 2_000_000,
        width: 160,
        height: 90,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: 500_000,
        audioBitrate: 64_000,
        sink: sink.writable,
        cleanupSink: () => sink.cleanup(),
        signal: controller.signal,
        renderFrame: request => {
          renderedFrames += 1;
          if (renderedFrames === 4) controller.abort('mid-export-test');
          const canvas = new OffscreenCanvas(request.width, request.height);
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('2D context unavailable');
          context.fillStyle = 'rgb(32 64 96)';
          context.fillRect(0, 0, request.width, request.height);
          return Promise.resolve(
            new VideoFrame(canvas, {
              timestamp: request.timestampUs,
              duration: request.durationUs,
            }),
          );
        },
        renderAudio: request =>
          Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
    expect(renderedFrames).toBe(4);
    expect(sink.finalize()).toHaveLength(0);
    expect(sink.snapshot()).toMatchObject({
      finalSize: 0,
      maxInFlightWrites: 0,
      closed: true,
      aborted: true,
    });
  });

  it('cancels from the final audio progress callback before finalization', async () => {
    const controller = new AbortController();
    const sink = new SeekableMemorySink();
    const progress: number[] = [];
    await expect(
      exportWebM({
        durationUs: 200_000,
        width: 160,
        height: 90,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: 500_000,
        audioBitrate: 64_000,
        sink: sink.writable,
        cleanupSink: () => sink.cleanup(),
        signal: controller.signal,
        renderFrame: request => {
          const canvas = new OffscreenCanvas(request.width, request.height);
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('2D context unavailable');
          context.fillRect(0, 0, request.width, request.height);
          return Promise.resolve(
            new VideoFrame(canvas, {
              timestamp: request.timestampUs,
              duration: request.durationUs,
            }),
          );
        },
        renderAudio: request =>
          Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
        onProgress: value => {
          progress.push(value);
          if (value > 0.99 && value < 1) controller.abort('final-audio-progress-test');
        },
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
    expect(progress.some(value => value > 0.99 && value < 1)).toBe(true);
    expect(progress.filter(value => value === 1)).toHaveLength(0);
    expect(sink.finalize()).toHaveLength(0);
    expect(sink.snapshot()).toMatchObject({
      finalSize: 0,
      closed: true,
      aborted: true,
    });
  });

  it('returns a stable diagnostic and clears partial output after a storage failure', async () => {
    const backing = new SeekableMemorySink();
    let writes = 0;
    const writer = backing.writable.getWriter();
    const failingSink = new WritableStream<{
      readonly type: 'write';
      readonly data: Uint8Array<ArrayBuffer>;
      readonly position: number;
    }>({
      write: async chunk => {
        writes += 1;
        await writer.write(chunk);
        if (writes >= 1) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      close: () => writer.close(),
      abort: reason => writer.abort(reason),
    });

    await expect(
      exportWebM({
        durationUs: 1_000_000,
        width: 160,
        height: 90,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: 500_000,
        audioBitrate: 64_000,
        sink: failingSink,
        cleanupSink: () => backing.cleanup(),
        renderFrame: request => {
          const canvas = new OffscreenCanvas(request.width, request.height);
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('2D context unavailable');
          context.fillRect(0, 0, request.width, request.height);
          return Promise.resolve(
            new VideoFrame(canvas, {
              timestamp: request.timestampUs,
              duration: request.durationUs,
            }),
          );
        },
        renderAudio: request =>
          Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'EXPORT_STORAGE_WRITE_FAILED' })],
    });
    expect(backing.finalize()).toHaveLength(0);
    expect(backing.snapshot()).toMatchObject({ closed: true, aborted: true, finalSize: 0 });
  });

  it('releases a rejected frame and clears the sink after encoder ingest failure', async () => {
    const sink = new SeekableMemorySink();
    await expect(
      exportWebM({
        durationUs: 200_000,
        width: 160,
        height: 90,
        frameRate: { numerator: 30, denominator: 1 },
        sampleRate: 48_000,
        channelCount: 2,
        videoBitrate: 500_000,
        audioBitrate: 64_000,
        sink: sink.writable,
        cleanupSink: () => sink.cleanup(),
        renderFrame: request => {
          const canvas = new OffscreenCanvas(request.width, request.height);
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('2D context unavailable');
          context.fillRect(0, 0, request.width, request.height);
          const frame = new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          });
          frame.close();
          return Promise.resolve(frame);
        },
        renderAudio: request =>
          Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'EXPORT_VIDEO_ENCODER_FAILED' })],
    });
    expect(sink.finalize()).toHaveLength(0);
    expect(sink.snapshot()).toMatchObject({ closed: true, aborted: true, finalSize: 0 });
  });

  it('preflights and freezes the Render IR revision before creating encoders', async () => {
    const sink = new SeekableMemorySink();
    const common = {
      ir: frozenIr(),
      videoBitrate: 500_000,
      audioBitrate: 64_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: (request: { readonly timestampUs: number; readonly durationUs: number }) => {
        const canvas = new OffscreenCanvas(160, 90);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2D context unavailable');
        context.fillStyle = 'rgb(10 20 30)';
        context.fillRect(0, 0, 160, 90);
        return Promise.resolve(
          new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          }),
        );
      },
      renderAudio: (request: { readonly frameCount: number; readonly channelCount: number }) =>
        Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
    } as const;
    const mismatch = await preflightWebMExport({ ...common, projectRevision: 8n });
    expect(mismatch).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'EXPORT_REVISION_MISMATCH' })],
    });
    await expect(
      exportFrozenRenderIrWebM({ ...common, projectRevision: 8n }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'EXPORT_REVISION_MISMATCH' })],
    });
    const result = await exportFrozenRenderIrWebM({ ...common, projectRevision: 7n });
    expect(result).toMatchObject({ durationUs: 200_000, videoFrames: 6, audioFrames: 9_600 });
  });

  it('streams seekable output to OPFS without assembling a full in-memory Blob', async () => {
    const sink = new OpfsSeekableSink(`aelion-export-${crypto.randomUUID()}.webm`);
    const result = await exportFrozenRenderIrWebM({
      ir: frozenIr(),
      projectRevision: 7n,
      videoBitrate: 500_000,
      audioBitrate: 64_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: request => {
        const canvas = new OffscreenCanvas(request.width, request.height);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2D context unavailable');
        context.fillStyle = 'rgb(12 34 56)';
        context.fillRect(0, 0, request.width, request.height);
        return Promise.resolve(
          new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          }),
        );
      },
      renderAudio: request =>
        Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
    });
    const file = await sink.getFile();
    expect(result.videoFrames).toBe(6);
    expect(result.encoderConfiguration).toEqual({
      profile: 'webm-vp9-opus',
      video: {
        codec: 'vp9',
        codecString: 'vp09.00.10.08',
        width: 160,
        height: 90,
        frameRate: 30,
        bitrateMode: 'variable',
        targetBitrate: 500_000,
      },
      audio: {
        codec: 'opus',
        sampleRate: 48_000,
        channelCount: 2,
        bitrateMode: 'variable',
        targetBitrate: 64_000,
      },
    });
    expect(file.size).toBeGreaterThan(500);
    expect(sink.snapshot()).toMatchObject({
      closed: true,
      aborted: false,
      maxInFlightWrites: 1,
    });
  });

  it('waits for OPFS stream finalization when getFile is requested early', async () => {
    const sink = new OpfsSeekableSink(`aelion-finalize-${crypto.randomUUID()}.bin`);
    const pendingFile = sink.getFile();
    let settled = false;
    void pendingFile.finally(() => {
      settled = true;
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    expect(settled).toBe(false);
    const writer = sink.writable.getWriter();
    await writer.write({ type: 'write', position: 0, data: new Uint8Array([1, 2, 3]) });
    await writer.close();
    await expect(pendingFile).resolves.toMatchObject({ size: 3 });
    await sink.cleanup();
  });
});
