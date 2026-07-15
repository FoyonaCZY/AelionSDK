import { describe, expect, it } from 'vitest';

import { exportWav, SeekableMemorySink } from '../src/index.js';

describe('audio-only export', () => {
  it('streams a deterministic PCM WAV with bounded block writes', async () => {
    const sink = new SeekableMemorySink();
    const result = await exportWav({
      durationUs: 100_000,
      sampleRate: 48_000,
      channelCount: 2,
      blockFrames: 1_024,
      sink: sink.writable,
      renderAudio: request => {
        const pcm = new Float32Array(request.frameCount * request.channelCount);
        pcm.fill(0.5);
        return Promise.resolve(pcm);
      },
    });
    const bytes = sink.finalize();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(4_800 * 2 * 2);
    expect(view.getInt16(44, true)).toBe(16_384);
    expect(result).toEqual({
      mimeType: 'audio/wav',
      audioFrames: 4_800,
      durationUs: 100_000,
      bytesWritten: 44 + 4_800 * 2 * 2,
      rf64: false,
    });
    expect(sink.snapshot()).toMatchObject({ writes: 6, maxInFlightWrites: 1, closed: true });
  });

  it('cleans partial output when audio rendering is aborted', async () => {
    const sink = new SeekableMemorySink();
    const controller = new AbortController();
    await expect(
      exportWav({
        durationUs: 100_000,
        sampleRate: 48_000,
        channelCount: 1,
        blockFrames: 1_024,
        sink: sink.writable,
        cleanupSink: () => sink.cleanup(),
        signal: controller.signal,
        renderAudio: request => {
          controller.abort('test');
          return Promise.resolve(new Float32Array(request.frameCount));
        },
      }),
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'OPERATION_ABORTED' })],
    });
    expect(sink.finalize()).toHaveLength(0);
  });
});
