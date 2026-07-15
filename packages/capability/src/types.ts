import type { Diagnostic, JsonValue } from '@aelion/core';

export type CapabilityStatus = 'supported' | 'degraded' | 'unsupported' | 'unknown';
export type CapabilityTier = 'a' | 'b' | 'c' | 'unsupported';

export interface CapabilityProbe {
  readonly status: CapabilityStatus;
  readonly available: boolean;
  readonly details?: Readonly<Record<string, JsonValue>>;
  readonly diagnostics?: readonly Diagnostic[];
}

export interface CodecConfigProbe {
  readonly id: string;
  readonly kind: 'video-decoder' | 'video-encoder' | 'audio-decoder' | 'audio-encoder';
  readonly codec: string;
  readonly supported: boolean;
  readonly config: Readonly<Record<string, JsonValue>>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface GpuCapability {
  readonly webgpu: CapabilityProbe;
  readonly webgl2: CapabilityProbe;
  readonly offscreenCanvas: CapabilityProbe;
  readonly worker: CapabilityProbe;
  readonly adapter?: {
    readonly features: readonly string[];
    readonly limits: Readonly<Record<string, number>>;
  };
}

export interface AudioCapability {
  readonly audioContext: CapabilityProbe;
  readonly audioWorklet: CapabilityProbe;
  readonly sharedArrayBuffer: CapabilityProbe;
}

export interface StorageCapability {
  readonly opfs: CapabilityProbe;
  readonly fileSystemAccess: CapabilityProbe;
  readonly transferableStreams: CapabilityProbe;
}

export interface CapabilityEnvironment {
  readonly userAgent: string;
  readonly platform: string;
  readonly language: string;
  readonly hardwareConcurrency: number | null;
  readonly deviceMemoryGiB: number | null;
  readonly crossOriginIsolated: boolean;
  readonly secureContext: boolean;
  readonly origin: string;
}

export interface CapabilityReport {
  readonly schemaVersion: '1.0.0';
  readonly generatedAt: string;
  readonly tier: CapabilityTier;
  readonly environment: CapabilityEnvironment;
  readonly codecs: readonly CodecConfigProbe[];
  readonly gpu: GpuCapability;
  readonly audio: AudioCapability;
  readonly storage: StorageCapability;
  readonly wasm: {
    readonly available: CapabilityProbe;
  };
  readonly diagnostics: readonly Diagnostic[];
}

export interface CapabilityProbeOptions {
  readonly signal?: AbortSignal;
  readonly includeAdapterDetails?: boolean;
}
