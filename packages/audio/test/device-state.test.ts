import { describe, expect, it } from 'vitest';

import { AudioRuntimeStateMachine, type AudioOutputBackend } from '../src/index.js';

class FakeBackend extends EventTarget implements AudioOutputBackend {
  state = 'suspended';
  sinkId = 'default';
  failSwitch = false;

  resume(): Promise<void> {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    this.dispatchEvent(new Event('statechange'));
    return Promise.resolve();
  }

  setSinkId(sinkId: string): Promise<void> {
    if (this.failSwitch) return Promise.reject(new Error('device disappeared'));
    this.sinkId = sinkId;
    return Promise.resolve();
  }

  interrupt(): void {
    this.state = 'interrupted';
    this.dispatchEvent(new Event('statechange'));
  }
}

describe('AudioRuntimeStateMachine', () => {
  it('starts, switches devices without exposing the suspended intermediate state, and recovers', async () => {
    const backend = new FakeBackend();
    const runtime = new AudioRuntimeStateMachine(backend);
    await runtime.start();
    expect(runtime.snapshot()).toMatchObject({ state: 'running', outputDeviceId: 'default' });
    await runtime.switchOutputDevice('speaker-b');
    expect(runtime.snapshot()).toMatchObject({ state: 'running', outputDeviceId: 'speaker-b' });
    expect(backend.sinkId).toBe('speaker-b');
    backend.interrupt();
    expect(runtime.snapshot()).toMatchObject({
      state: 'interrupted',
      errorCode: 'AUDIO_CONTEXT_INTERRUPTED',
    });
    await runtime.recover();
    expect(runtime.snapshot().state).toBe('running');
    runtime.dispose();
    expect(runtime.disposed).toBe(true);
  });

  it('keeps the previous device and returns a stable diagnostic when switching fails', async () => {
    const backend = new FakeBackend();
    const runtime = new AudioRuntimeStateMachine(backend);
    await runtime.start();
    backend.failSwitch = true;
    await expect(runtime.switchOutputDevice('missing')).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'AUDIO_OUTPUT_DEVICE_SWITCH_FAILED' })],
    });
    expect(runtime.snapshot()).toMatchObject({
      state: 'failed',
      outputDeviceId: 'default',
      errorCode: 'AUDIO_OUTPUT_DEVICE_SWITCH_FAILED',
    });
  });
});
