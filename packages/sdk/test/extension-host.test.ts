import type { JsonValue } from '@aelion/core';
import { describe, expect, it, vi } from 'vitest';

import {
  AelionExtensionHost,
  exposeAelionExtension,
  type AelionExtensionHostMessage,
  type AelionExtensionRuntimeEndpoint,
  type AelionExtensionTransport,
  type AelionExtensionWorkerMessage,
} from '../src/index.js';

interface Loopback {
  readonly transport: AelionExtensionTransport;
  readonly endpoint: AelionExtensionRuntimeEndpoint;
  readonly terminate: ReturnType<typeof vi.fn>;
}

function loopback(): Loopback {
  const hostMessageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  const hostErrorListeners = new Set<(event: ErrorEvent) => void>();
  const workerListeners = new Set<(event: MessageEvent<unknown>) => void>();
  const terminate = vi.fn();
  const transport = {
    postMessage: (message: AelionExtensionHostMessage) => {
      queueMicrotask(() => {
        const event = { data: structuredClone(message) } as MessageEvent<unknown>;
        for (const listener of workerListeners) listener(event);
      });
    },
    addEventListener: (
      type: 'message' | 'error',
      listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
    ) => {
      if (type === 'message') {
        hostMessageListeners.add(listener as (event: MessageEvent<unknown>) => void);
      } else {
        hostErrorListeners.add(listener as (event: ErrorEvent) => void);
      }
    },
    removeEventListener: (
      type: 'message' | 'error',
      listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
    ) => {
      if (type === 'message') {
        hostMessageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
      } else {
        hostErrorListeners.delete(listener as (event: ErrorEvent) => void);
      }
    },
    terminate,
  } as AelionExtensionTransport;
  const endpoint: AelionExtensionRuntimeEndpoint = {
    postMessage: (message: AelionExtensionWorkerMessage) => {
      queueMicrotask(() => {
        const event = { data: structuredClone(message) } as MessageEvent<unknown>;
        for (const listener of hostMessageListeners) listener(event);
      });
    },
    addEventListener: (_type, listener) => workerListeners.add(listener),
    removeEventListener: (_type, listener) => workerListeners.delete(listener),
  };
  return { transport, endpoint, terminate };
}

describe('fault-isolated extension host', () => {
  it('exposes only declared JSON RPC methods and clones both boundaries', async () => {
    const channel = loopback();
    const disposeRuntime = exposeAelionExtension(
      channel.endpoint,
      { id: 'example.extension', version: '1.0.0', methods: ['echo'] },
      {
        echo: payload => ({ wrapped: payload }),
      },
    );
    const host = new AelionExtensionHost(channel.transport);
    await expect(host.ready).resolves.toMatchObject({ id: 'example.extension' });
    const input: JsonValue = { nested: ['value'] };
    const result = await host.invoke('echo', input);
    expect(result).toEqual({ wrapped: input });
    expect(result).not.toBe(input);
    await expect(host.invoke('undeclared', null)).rejects.toThrow('does not expose');
    expect(host.snapshot()).toMatchObject({
      ready: true,
      pendingCalls: 0,
      disposed: false,
    });
    host.dispose();
    disposeRuntime();
    expect(channel.terminate).toHaveBeenCalledOnce();
  });

  it('enforces payload and queue budgets before unbounded work is admitted', async () => {
    const channel = loopback();
    exposeAelionExtension(
      channel.endpoint,
      { id: 'bounded.extension', version: '1', methods: ['hold'] },
      {
        hold: (_payload, context) =>
          new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              reject(
                context.signal.reason instanceof Error
                  ? context.signal.reason
                  : new DOMException('aborted', 'AbortError'),
              );
            });
          }),
      },
    );
    const host = new AelionExtensionHost(channel.transport, {
      maxPendingCalls: 1,
      maxPayloadBytes: 128,
    });
    await host.ready;
    const controller = new AbortController();
    const pending = host.invoke('hold', null, { signal: controller.signal });
    await expect(host.invoke('hold', null)).rejects.toThrow('queue');
    await expect(host.invoke('hold', 'x'.repeat(1_000))).rejects.toThrow('queue');
    controller.abort(new DOMException('stop', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(host.invoke('hold', 'x'.repeat(1_000))).rejects.toThrow('payload');
    host.dispose();
  });

  it('propagates extension errors and terminates a timed-out Worker', async () => {
    const channel = loopback();
    exposeAelionExtension(
      channel.endpoint,
      { id: 'fault.extension', version: '1', methods: ['fail', 'hang'] },
      {
        fail: () => {
          throw new TypeError('bad extension input');
        },
        hang: () => new Promise(() => undefined),
      },
    );
    const host = new AelionExtensionHost(channel.transport, {
      invocationTimeoutMs: 20,
    });
    await host.ready;
    await expect(host.invoke('fail', null)).rejects.toMatchObject({
      name: 'TypeError',
      message: 'bad extension input',
    });
    await expect(host.invoke('hang', null)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(host.snapshot().disposed).toBe(true);
    expect(channel.terminate).toHaveBeenCalledOnce();
  });
});
