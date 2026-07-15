import type { Diagnostic, JsonValue } from '@aelion/core';
import { throwIfAborted } from '@aelion/core';

import type {
  AudioCapability,
  CapabilityEnvironment,
  CapabilityProbe,
  CapabilityProbeOptions,
  CapabilityReport,
  CapabilityTier,
  CodecConfigProbe,
  GpuCapability,
  StorageCapability,
} from './types.js';

interface NavigatorWithMemory extends Navigator {
  readonly deviceMemory?: number;
  readonly gpu?: {
    requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<{
      readonly features: ReadonlySet<string>;
      readonly limits: object;
      requestDevice(): Promise<{ destroy(): void }>;
    } | null>;
  };
}

interface CodecSupportResult {
  readonly supported?: boolean;
  readonly config?: object;
}

interface CodecConstructor {
  isConfigSupported(config: object): Promise<CodecSupportResult>;
}

function diagnostic(
  code: string,
  message: string,
  recoverable: boolean,
  cause?: unknown,
): Diagnostic {
  return {
    code,
    severity: recoverable ? 'warning' : 'error',
    message,
    recoverable,
    ...(cause === undefined ? {} : { cause }),
  };
}

function supported(details?: Readonly<Record<string, JsonValue>>): CapabilityProbe {
  return {
    status: 'supported',
    available: true,
    ...(details === undefined ? {} : { details }),
  };
}

function unsupported(code: string, message: string): CapabilityProbe {
  return {
    status: 'unsupported',
    available: false,
    diagnostics: [diagnostic(code, message, true)],
  };
}

function failed(code: string, message: string, cause: unknown): CapabilityProbe {
  return {
    status: 'unknown',
    available: false,
    diagnostics: [diagnostic(code, message, true, cause)],
  };
}

async function probeCodec(
  id: string,
  kind: CodecConfigProbe['kind'],
  constructorName: 'VideoDecoder' | 'VideoEncoder' | 'AudioDecoder' | 'AudioEncoder',
  config: Record<string, JsonValue>,
): Promise<CodecConfigProbe> {
  const codec = typeof config.codec === 'string' ? config.codec : '';
  const constructor = Reflect.get(globalThis, constructorName) as CodecConstructor | undefined;
  if (constructor === undefined || typeof constructor.isConfigSupported !== 'function') {
    return {
      id,
      kind,
      codec,
      supported: false,
      config,
      diagnostics: [
        diagnostic('CAPABILITY_CODEC_API_UNAVAILABLE', `${constructorName} is unavailable`, true),
      ],
    };
  }

  try {
    const result = await constructor.isConfigSupported(config);
    return {
      id,
      kind,
      codec,
      supported: result.supported === true,
      config: (result.config ?? config) as Record<string, JsonValue>,
      diagnostics:
        result.supported === true
          ? []
          : [
              diagnostic(
                'CAPABILITY_CODEC_CONFIG_UNSUPPORTED',
                `${constructorName} does not support ${codec}`,
                true,
              ),
            ],
    };
  } catch (cause) {
    return {
      id,
      kind,
      codec,
      supported: false,
      config,
      diagnostics: [
        diagnostic(
          'CAPABILITY_CODEC_PROBE_FAILED',
          `${constructorName} rejected the ${codec} capability probe`,
          true,
          cause,
        ),
      ],
    };
  }
}

function codecConfigs(): {
  readonly id: string;
  readonly kind: CodecConfigProbe['kind'];
  readonly constructorName: 'VideoDecoder' | 'VideoEncoder' | 'AudioDecoder' | 'AudioEncoder';
  readonly config: Record<string, JsonValue>;
}[] {
  return [
    {
      id: 'decode-h264-1080p',
      kind: 'video-decoder',
      constructorName: 'VideoDecoder',
      config: { codec: 'avc1.42001e', codedWidth: 1920, codedHeight: 1080 },
    },
    {
      id: 'decode-vp9-1080p',
      kind: 'video-decoder',
      constructorName: 'VideoDecoder',
      config: { codec: 'vp09.00.10.08', codedWidth: 1920, codedHeight: 1080 },
    },
    {
      id: 'encode-h264-1080p30',
      kind: 'video-encoder',
      constructorName: 'VideoEncoder',
      config: {
        codec: 'avc1.42001e',
        width: 1920,
        height: 1080,
        bitrate: 8_000_000,
        framerate: 30,
        avc: { format: 'avc' },
      },
    },
    {
      id: 'encode-vp9-1080p30',
      kind: 'video-encoder',
      constructorName: 'VideoEncoder',
      config: {
        codec: 'vp09.00.10.08',
        width: 1920,
        height: 1080,
        bitrate: 8_000_000,
        framerate: 30,
      },
    },
    {
      id: 'decode-aac-stereo',
      kind: 'audio-decoder',
      constructorName: 'AudioDecoder',
      config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 },
    },
    {
      id: 'decode-opus-stereo',
      kind: 'audio-decoder',
      constructorName: 'AudioDecoder',
      config: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 },
    },
    {
      id: 'encode-aac-stereo',
      kind: 'audio-encoder',
      constructorName: 'AudioEncoder',
      config: {
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      },
    },
    {
      id: 'encode-opus-stereo',
      kind: 'audio-encoder',
      constructorName: 'AudioEncoder',
      config: {
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      },
    },
  ];
}

function numberLimits(limits: object): Record<string, number> {
  const output: Record<string, number> = {};
  for (const key of Object.keys(Object.getPrototypeOf(limits) as object)) {
    const value: unknown = Reflect.get(limits, key);
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  for (const key of Object.keys(limits)) {
    const value: unknown = Reflect.get(limits, key);
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  return output;
}

async function probeGpu(includeAdapterDetails: boolean): Promise<GpuCapability> {
  const worker =
    typeof Worker === 'function'
      ? supported()
      : unsupported('CAPABILITY_WORKER_UNAVAILABLE', 'Worker is unavailable');
  const offscreenCanvas =
    typeof OffscreenCanvas === 'function'
      ? supported()
      : unsupported('CAPABILITY_OFFSCREEN_CANVAS_UNAVAILABLE', 'OffscreenCanvas is unavailable');

  let webgl2: CapabilityProbe;
  try {
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    webgl2 =
      context === null
        ? unsupported('CAPABILITY_WEBGL2_UNAVAILABLE', 'WebGL2 context creation failed')
        : supported({
            renderer:
              context instanceof WebGL2RenderingContext
                ? (context.getParameter(context.RENDERER) as string)
                : 'offscreen-webgl2',
          });
    if (context instanceof WebGL2RenderingContext) {
      context.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (cause) {
    webgl2 = failed('CAPABILITY_WEBGL2_PROBE_FAILED', 'WebGL2 probe failed', cause);
  }

  const gpu = (navigator as NavigatorWithMemory).gpu;
  if (gpu === undefined) {
    return {
      worker,
      offscreenCanvas,
      webgl2,
      webgpu: unsupported('CAPABILITY_WEBGPU_UNAVAILABLE', 'WebGPU is unavailable'),
    };
  }

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter === null) {
      return {
        worker,
        offscreenCanvas,
        webgl2,
        webgpu: unsupported(
          'CAPABILITY_WEBGPU_ADAPTER_UNAVAILABLE',
          'No WebGPU adapter is available',
        ),
      };
    }
    const device = await adapter.requestDevice();
    device.destroy();
    return {
      worker,
      offscreenCanvas,
      webgl2,
      webgpu: supported(),
      ...(includeAdapterDetails
        ? {
            adapter: {
              features: [...adapter.features].sort(),
              limits: numberLimits(adapter.limits),
            },
          }
        : {}),
    };
  } catch (cause) {
    return {
      worker,
      offscreenCanvas,
      webgl2,
      webgpu: failed('CAPABILITY_WEBGPU_PROBE_FAILED', 'WebGPU probe failed', cause),
    };
  }
}

function probeAudio(): AudioCapability {
  const standardAudioContext = Reflect.get(globalThis, 'AudioContext') as
    | typeof AudioContext
    | undefined;
  const webkitAudioContext = Reflect.get(globalThis, 'webkitAudioContext') as
    | typeof AudioContext
    | undefined;
  const AudioContextConstructor = standardAudioContext ?? webkitAudioContext;
  const audioContext =
    AudioContextConstructor === undefined
      ? unsupported('CAPABILITY_AUDIO_CONTEXT_UNAVAILABLE', 'AudioContext is unavailable')
      : supported();
  const audioWorklet =
    AudioContextConstructor !== undefined &&
    Reflect.has(AudioContextConstructor.prototype, 'audioWorklet')
      ? supported()
      : unsupported('CAPABILITY_AUDIO_WORKLET_UNAVAILABLE', 'AudioWorklet is unavailable');
  const sharedArrayBuffer =
    typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated
      ? supported()
      : {
          status: 'degraded' as const,
          available: typeof SharedArrayBuffer === 'function',
          diagnostics: [
            diagnostic(
              'CAPABILITY_SHARED_ARRAY_BUFFER_ISOLATION_REQUIRED',
              'SharedArrayBuffer requires a cross-origin isolated page',
              true,
            ),
          ],
        };
  return { audioContext, audioWorklet, sharedArrayBuffer };
}

function probeStorage(): StorageCapability {
  const storage = Reflect.get(navigator, 'storage') as
    | { readonly getDirectory?: unknown }
    | undefined;
  const opfs =
    storage !== undefined && typeof storage.getDirectory === 'function'
      ? supported()
      : unsupported('CAPABILITY_OPFS_UNAVAILABLE', 'OPFS is unavailable');
  const fileSystemAccess =
    typeof Reflect.get(globalThis, 'showSaveFilePicker') === 'function'
      ? supported()
      : unsupported(
          'CAPABILITY_FILE_SYSTEM_ACCESS_UNAVAILABLE',
          'File System Access save picker is unavailable',
        );
  const transferableStreams =
    typeof ReadableStream === 'function' && typeof TransformStream === 'function'
      ? supported()
      : unsupported(
          'CAPABILITY_TRANSFERABLE_STREAMS_UNAVAILABLE',
          'Web Streams primitives are unavailable',
        );
  return { opfs, fileSystemAccess, transferableStreams };
}

function environment(): CapabilityEnvironment {
  const navigatorWithMemory = navigator as NavigatorWithMemory;
  const userAgentData = Reflect.get(navigator, 'userAgentData') as
    | { readonly platform?: string }
    | undefined;
  return {
    userAgent: navigator.userAgent,
    platform: userAgentData?.platform ?? 'unknown',
    language: navigator.language,
    hardwareConcurrency:
      Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : null,
    deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    secureContext: globalThis.isSecureContext,
    origin: globalThis.location.origin,
  };
}

function tier(
  codecs: readonly CodecConfigProbe[],
  gpu: GpuCapability,
  audio: AudioCapability,
): CapabilityTier {
  const hasVideoDecode = codecs.some(codec => codec.kind === 'video-decoder' && codec.supported);
  if (
    hasVideoDecode &&
    gpu.webgpu.available &&
    gpu.offscreenCanvas.available &&
    audio.audioWorklet.available
  ) {
    return 'a';
  }
  if (hasVideoDecode && gpu.webgl2.available && audio.audioWorklet.available) return 'b';
  if (hasVideoDecode || gpu.webgl2.available) return 'c';
  return 'unsupported';
}

export async function probeCapabilities(
  options: CapabilityProbeOptions = {},
): Promise<CapabilityReport> {
  throwIfAborted(options.signal, 'capability probe');
  const [codecs, gpu] = await Promise.all([
    Promise.all(
      codecConfigs().map(config =>
        probeCodec(config.id, config.kind, config.constructorName, config.config),
      ),
    ),
    probeGpu(options.includeAdapterDetails ?? true),
  ]);
  throwIfAborted(options.signal, 'capability probe');
  const audio = probeAudio();
  const storage = probeStorage();
  const diagnostics = [
    ...codecs.flatMap(codec => codec.diagnostics),
    ...(gpu.webgpu.diagnostics ?? []),
    ...(gpu.webgl2.diagnostics ?? []),
    ...(gpu.offscreenCanvas.diagnostics ?? []),
    ...(gpu.worker.diagnostics ?? []),
    ...(audio.audioContext.diagnostics ?? []),
    ...(audio.audioWorklet.diagnostics ?? []),
    ...(audio.sharedArrayBuffer.diagnostics ?? []),
    ...(storage.opfs.diagnostics ?? []),
    ...(storage.fileSystemAccess.diagnostics ?? []),
    ...(storage.transferableStreams.diagnostics ?? []),
  ];
  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    tier: tier(codecs, gpu, audio),
    environment: environment(),
    codecs,
    gpu,
    audio,
    storage,
    wasm:
      typeof WebAssembly === 'object'
        ? { available: supported() }
        : {
            available: unsupported(
              'CAPABILITY_WEBASSEMBLY_UNAVAILABLE',
              'WebAssembly is unavailable',
            ),
          },
    diagnostics,
  };
}
