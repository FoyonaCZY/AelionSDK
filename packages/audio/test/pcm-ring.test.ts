import { describe, expect, it } from 'vitest';

import { SharedPcmRingBuffer } from '../src/index.js';

describe('SharedPcmRingBuffer', () => {
  it('wraps interleaved writes into planar reads without allocation growth', () => {
    const ring = SharedPcmRingBuffer.allocate(4, 2, 48_000);
    expect(ring.writeInterleaved(new Float32Array([1, 10, 2, 20, 3, 30]))).toBe(3);
    const left = new Float32Array(2);
    const right = new Float32Array(2);
    expect(ring.readPlanar([left, right])).toBe(2);
    expect([...left]).toEqual([1, 2]);
    expect([...right]).toEqual([10, 20]);
    expect(ring.writeInterleaved(new Float32Array([4, 40, 5, 50, 6, 60]))).toBe(3);
    const leftWrap = new Float32Array(4);
    const rightWrap = new Float32Array(4);
    expect(ring.readPlanar([leftWrap, rightWrap])).toBe(4);
    expect([...leftWrap]).toEqual([3, 4, 5, 6]);
    expect([...rightWrap]).toEqual([30, 40, 50, 60]);
  });

  it('records underrun frames and zero-fills output', () => {
    const ring = SharedPcmRingBuffer.allocate(8, 1, 48_000);
    ring.writeInterleaved(new Float32Array([0.25, 0.5]));
    const output = new Float32Array(4);
    expect(ring.readPlanar([output])).toBe(2);
    expect([...output]).toEqual([0.25, 0.5, 0, 0]);
    expect(ring.snapshot().underrunFrames).toBe(2);
  });

  it('runs a ten-minute equivalent bounded producer/consumer simulation without underrun', () => {
    const sampleRate = 48_000;
    const quantum = 128;
    const ring = SharedPcmRingBuffer.allocate(4_096, 2, sampleRate);
    const block = new Float32Array(quantum * 2);
    const left = new Float32Array(quantum);
    const right = new Float32Array(quantum);
    const totalQuanta = (sampleRate * 60 * 10) / quantum;
    let writeMismatch = 0;
    let readMismatch = 0;

    for (let quantumIndex = 0; quantumIndex < totalQuanta; quantumIndex += 1) {
      if (ring.writeInterleaved(block) !== quantum) writeMismatch += 1;
      if (ring.readPlanar([left, right]) !== quantum) readMismatch += 1;
    }

    expect(writeMismatch).toBe(0);
    expect(readMismatch).toBe(0);
    expect(ring.snapshot()).toMatchObject({
      availableReadFrames: 0,
      availableWriteFrames: 4_096,
      playedFrames: sampleRate * 60 * 10,
      underrunFrames: 0,
      state: 'open',
    });
  });

  it('does not accept writes after end or close', () => {
    const ring = SharedPcmRingBuffer.allocate(8, 1, 48_000);
    ring.end();
    expect(ring.writeInterleaved(new Float32Array([1]))).toBe(0);
    expect(ring.snapshot().state).toBe('ended');
    ring.close();
    expect(ring.snapshot().state).toBe('closed');
  });

  it('drops all queued PCM when closed', () => {
    const ring = SharedPcmRingBuffer.allocate(8, 1, 48_000);
    expect(ring.writeInterleaved(new Float32Array([1, 2, 3, 4]))).toBe(4);

    ring.close();

    expect(ring.snapshot()).toMatchObject({
      availableReadFrames: 0,
      availableWriteFrames: 8,
      state: 'closed',
    });
  });

  it('flushes queued PCM for a seek without reallocating the bounded ring', () => {
    const ring = SharedPcmRingBuffer.allocate(8, 1, 48_000);
    const buffer = ring.buffer;
    ring.writeInterleaved(new Float32Array([1, 2, 3, 4]));
    ring.flush();

    expect(ring.buffer).toBe(buffer);
    expect(ring.snapshot()).toMatchObject({
      availableReadFrames: 0,
      availableWriteFrames: 8,
      playedFrames: 0,
      underrunFrames: 0,
      state: 'open',
    });
  });
});
