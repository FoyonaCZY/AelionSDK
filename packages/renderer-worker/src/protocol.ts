import type { JsonValue } from '@aelion/core';
import type { WebGl2MaterialProgram } from '@aelion/material-compiler';

export interface ComposeRequest {
  readonly type: 'compose';
  readonly id: number;
  readonly inputs: Readonly<Record<string, VideoFrame>>;
  readonly program: WebGl2MaterialProgram;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly systems: Readonly<Record<string, number>>;
  readonly width: number;
  readonly height: number;
  readonly preferredBackend: 'webgpu' | 'webgl2';
  readonly allowFallback: boolean;
  /** @internal Conformance-only loss injection; production callers must omit it. */
  readonly debugSimulateLoss?: 'webgpu-device' | 'webgl2-context';
}

export interface RendererWorkerResourceSnapshot {
  /** Worker requests still executing after this request completed. */
  readonly activeRequests: number;
  /** Active requests with cancellation pending after this request completed. */
  readonly cancelledRequests: number;
  readonly webgpuDevices: number;
  readonly webgpuPipelines: number;
  readonly webgpuBuffers: number;
  readonly webgpuTextures: number;
  readonly webgl2Contexts: number;
  readonly webgl2Programs: number;
  readonly webgl2Buffers: number;
  readonly webgl2Textures: number;
  readonly inputFrames: number;
}

export interface RendererWorkerDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface RendererWorkerTiming {
  /** Worker request wall time including setup, compilation, draw and readback. */
  readonly totalWorkerUs: number;
  /** Time spent waiting for submitted GPU work to complete (driver-inclusive proxy). */
  readonly gpuCompletionUs: number;
}

export interface DisposeRequest {
  readonly type: 'dispose';
}

export interface CancelRequest {
  readonly type: 'cancel';
  readonly id: number;
}

/** @internal Conformance-only Worker resource inspection. */
export interface InspectResourcesRequest {
  readonly type: 'inspect-resources';
  readonly responsePort: MessagePort;
}

/** @internal Conformance-only Worker request-set snapshot. */
export interface RendererWorkerRequestSetSnapshot {
  readonly activeRequests: number;
  readonly cancelledRequests: number;
}

export type RendererWorkerRequest =
  | ComposeRequest
  | CancelRequest
  | DisposeRequest
  | InspectResourcesRequest;

export interface ComposeSuccess {
  readonly type: 'composed';
  readonly id: number;
  readonly bitmap: ImageBitmap;
  readonly backend: 'webgpu' | 'webgl2';
  readonly graphHash: string;
  readonly diagnostics: readonly RendererWorkerDiagnostic[];
  /** Transient Worker resources after the request; the returned bitmap is caller-owned. */
  readonly resources: RendererWorkerResourceSnapshot;
  readonly outputBitmapOwner: 'caller';
  readonly timing: RendererWorkerTiming;
}

export interface ComposeFailure {
  readonly type: 'failed';
  readonly id: number;
  readonly code: string;
  readonly message: string;
}

/** Worker acknowledgement emitted only after a cancelled request has released its resources. */
export interface ComposeCancelled {
  readonly type: 'cancelled';
  readonly id: number;
}

export type RendererWorkerResponse = ComposeSuccess | ComposeFailure | ComposeCancelled;
