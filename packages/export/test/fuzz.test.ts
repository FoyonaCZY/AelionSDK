import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { exportWav, SeekableMemorySink } from '../src/index.js';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

describe('WAV export bytes invariants', () => {
  it('writes a self-consistent RIFF/RF64 header for arbitrary valid parameters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom(8_000, 16_000, 44_100, 48_000, 96_000),
        fc.integer({ min: 1, max: 60_000 }),
        fc.constantFrom('s16', 'f32'),
        fc.integer({ min: 1, max: 1_000 }),
        async (channelCount, sampleRate, durationUs, sampleFormat, blockFrames) => {
          const sink = new SeekableMemorySink();
          const result = await exportWav({
            durationUs,
            sampleRate,
            channelCount,
            sampleFormat,
            blockFrames,
            sink: sink.writable,
            renderAudio: request =>
              Promise.resolve(new Float32Array(request.frameCount * request.channelCount)),
          });
          const bytes = sink.finalize();
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const container = ascii(bytes, 0, 4);
          expect(['RIFF', 'RF64']).toContain(container);
          expect(ascii(bytes, 8, 4)).toBe('WAVE');

          const headerLen = container === 'RF64' ? 80 : 44;
          expect(bytes.byteLength).toBe(
            headerLen + result.audioFrames * channelCount * (sampleFormat === 's16' ? 2 : 4),
          );
          expect(result.audioFrames).toBe(Math.floor((durationUs * sampleRate) / 1_000_000));

          if (container === 'RIFF') {
            expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
            expect(view.getUint16(22, true)).toBe(channelCount);
            expect(view.getUint32(24, true)).toBe(sampleRate);
            expect(view.getUint16(34, true)).toBe((sampleFormat === 's16' ? 2 : 4) * 8);
            expect(view.getUint32(40, true)).toBe(bytes.byteLength - 44);
          } else {
            expect(view.getUint32(4, true)).toBe(0xffff_ffff);
            expect(view.getBigUint64(20, true)).toBe(BigInt(bytes.byteLength - 8));
            expect(view.getBigUint64(28, true)).toBe(
              BigInt(result.audioFrames * channelCount * (sampleFormat === 's16' ? 2 : 4)),
            );
            expect(view.getUint16(58, true)).toBe(channelCount);
            expect(view.getUint32(60, true)).toBe(sampleRate);
            expect(view.getUint16(70, true)).toBe((sampleFormat === 's16' ? 2 : 4) * 8);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
