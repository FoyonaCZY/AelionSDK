import type { PcmSourceBlock } from '@aelion/audio';
import type { CapabilityReport } from '@aelion/capability';
import type { Diagnostic, JsonObject, JsonValue } from '@aelion/core';
import type {
  ExportProfileId,
  ExportPreflightReport,
  GifExportResult,
  RemoteExportAuthorizer,
  RemoteExportProvider,
  RemoteExportResult,
  StillImageExportResult,
  WavExportResult,
  WebMExportOptions,
  WebMExportResult,
} from '@aelion/export';
import type { WebGl2MaterialProgram } from '@aelion/material-compiler';
import type { AelionProject } from '@aelion/project-schema';
import type { CompileStats, IrMaterialDefinition, RenderIr } from '@aelion/render-ir';
import type { RenderIrFrameResult } from '@aelion/renderer-worker';
import type { EditingCommands, TransactionBuilder, TransactionCommit } from '@aelion/transaction';

export interface AelionProjectSchemas {
  readonly project: JsonObject;
  readonly materialInstance: JsonObject;
}

export interface AelionMediaRequest {
  /** Preview may use an appropriate proxy. Export always requests the original representation. */
  readonly purpose: 'preview' | 'export';
  /** Largest requested output dimension, used to choose a right-sized preview proxy. */
  readonly maxDimension: number;
}

export interface AelionMediaProvider {
  frameAt(
    assetId: string,
    streamIndex: number,
    sourceTimeUs: number,
    signal?: AbortSignal,
    request?: AelionMediaRequest,
  ): Promise<VideoFrame>;
  pcmRange(
    assetId: string,
    streamIndex: number,
    startUs: number,
    durationUs: number,
    signal?: AbortSignal,
  ): Promise<PcmSourceBlock>;
}

export interface AelionRuntimeMaterialRegistry {
  resolveProgram(
    definition: IrMaterialDefinition,
    parameters: Readonly<Record<string, JsonValue>>,
  ): WebGl2MaterialProgram | undefined;
}

export interface AelionSessionOptions {
  /** Overrides the v1 schemas bundled with `@aelion/sdk`. */
  readonly schemas?: AelionProjectSchemas;
  readonly media?: AelionMediaProvider;
  readonly materials?: AelionRuntimeMaterialRegistry;
  readonly sequenceId?: string;
  readonly preferredBackend?: 'webgpu' | 'webgl2';
  readonly allowBackendFallback?: boolean;
  /** Maximum full Preview/Player/Export frame evaluations in flight. Defaults to 2. */
  readonly maxPendingFrames?: number;
  /** Maximum retained diagnostic history entries. Defaults to 256. */
  readonly maxDiagnostics?: number;
}

export type AelionSessionState = 'empty' | 'ready' | 'disposed';
export type AelionPlayerState = 'idle' | 'paused' | 'playing' | 'ended' | 'error' | 'disposed';

export type AelionSessionEvent =
  | { readonly type: 'project-loaded'; readonly projectId: string; readonly revision: bigint }
  | { readonly type: 'project-changed'; readonly commit: TransactionCommit }
  | {
      readonly type: 'state-changed';
      readonly previousState: AelionSessionState;
      readonly state: AelionSessionState;
    }
  | { readonly type: 'capability-changed'; readonly capability: CapabilityReport }
  | { readonly type: 'stats-changed'; readonly stats: AelionSessionStats }
  | { readonly type: 'diagnostic'; readonly diagnostic: Diagnostic };

export type AelionSessionEventType = AelionSessionEvent['type'];
export type AelionSessionEventOf<T extends AelionSessionEventType> = Extract<
  AelionSessionEvent,
  { readonly type: T }
>;

export interface AelionPreviewQualityOptions {
  /** Draft defaults to half-resolution; full defaults to Project resolution. */
  readonly quality?: 'draft' | 'full';
  /** Explicit preview scale in (0, 1]. Overrides the quality default. */
  readonly renderScale?: number;
}

export interface AelionPreviewOptions extends AelionPreviewQualityOptions {
  readonly timeUs: number;
  readonly signal?: AbortSignal;
}

export interface AelionPlayerFrame {
  readonly generation: number;
  readonly frameIndex: number;
  readonly timestampUs: number;
  readonly droppedFrames: number;
  readonly result: RenderIrFrameResult;
}

export interface AelionPlayerApi {
  readonly state: AelionPlayerState;
  readonly currentTimeUs: number;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(timeUs: number): Promise<void>;
  scrub(timeUs: number): Promise<RenderIrFrameResult>;
  setPreviewQuality(options: AelionPreviewQualityOptions): void;
  getStats(): AelionPlayerStats;
  subscribe(listener: (frame: AelionPlayerFrame) => void): () => void;
}

export interface AelionPlayerStats {
  readonly state: AelionPlayerState;
  /** Last playhead timestamp observed by a state or rendered-frame update. */
  readonly currentTimeUs: number;
  readonly generation: number;
  readonly renderedFrames: number;
  readonly droppedFrames: number;
  readonly errors: number;
  readonly lastErrorCode: string | null;
  readonly previewQuality: {
    readonly quality: 'draft' | 'full';
    readonly renderScale: number;
  };
  /** Bounded runtime ownership state for diagnostics and leak conformance. */
  readonly resources: AelionPlayerResourceStats;
}

export interface AelionPlayerResourceStats {
  readonly listeners: number;
  readonly runtimeInitializing: boolean;
  readonly audioFillScheduled: boolean;
  readonly audioFillInFlight: boolean;
  readonly scheduler: {
    readonly present: boolean;
    readonly disposed: boolean;
    readonly scheduled: boolean;
    readonly rendering: boolean;
  };
  readonly audio: {
    readonly mode: 'none' | 'shared-ring' | 'transferable-queue';
    readonly disposed: boolean;
    readonly contextState: AudioContextState | 'interrupted' | null;
    readonly bufferedFrames: number;
    readonly closed: boolean;
  };
  /** Actual terminal state captured from the most recently released runtime. */
  readonly lastDisposedRuntime: {
    readonly schedulerDisposed: boolean;
    readonly audioDisposed: boolean;
    readonly audioContextClosed: boolean;
    readonly transportClosed: boolean;
    readonly bufferedFrames: number;
  } | null;
}

export interface AelionTransactionApi {
  readonly commands: EditingCommands;
  edit(
    callback: (transaction: TransactionBuilder) => void,
    options?: { readonly label?: string; readonly baseRevision?: bigint },
  ): TransactionCommit;
  beginInteractive(options?: AelionInteractiveEditOptions): AelionInteractiveEdit;
  undo(): TransactionCommit;
  redo(): TransactionCommit;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface AelionInteractiveEditOptions {
  readonly label?: string;
  /** Optimistic revision checked by the first update in the interaction. */
  readonly baseRevision?: bigint;
}

export interface AelionInteractiveEdit {
  readonly active: boolean;
  readonly updateCount: number;
  update(callback: (transaction: TransactionBuilder) => void): TransactionCommit;
  /** Seals the coalesced undo entry. No extra Project revision is created. */
  commit(): void;
  /** Restores the pre-interaction Project without leaving a redo entry. */
  cancel(): TransactionCommit | null;
}

export interface AelionExportOptions {
  readonly sink: WebMExportOptions['sink'];
  readonly videoBitrate?: number;
  readonly audioBitrate?: number;
  readonly signal?: AbortSignal;
  readonly cleanupSink?: (reason: unknown) => void | Promise<void>;
  readonly onProgress?: (progress: number) => void;
}

export interface AelionExportApi {
  preflight(options: AelionExportOptions): Promise<ExportPreflightReport>;
  preflightProfile(options: AelionProfileExportOptions): Promise<ExportPreflightReport>;
  /** Starts one frozen-revision export. The returned job remains await-compatible. */
  start(options: AelionExportOptions): AelionExportJob;
  /** Starts a non-default production export profile from the same frozen Render IR. */
  startProfile(options: AelionProfileExportOptions): AelionProfileExportJob;
  /** Starts a provider-backed export from one canonical, frozen Project manifest. */
  startRemote(options: AelionRemoteExportOptions): AelionRemoteExportJob;
  /** Cancels the active job, if one exists, and waits for pipeline cleanup. */
  cancel(reason?: unknown): Promise<void>;
  readonly activeJob: AelionExportJob | AelionProfileExportJob | AelionRemoteExportJob | null;
}

export type AelionExportJobState = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AelionExportJobSnapshot {
  readonly id: string;
  readonly state: AelionExportJobState;
  readonly progress: number;
}

interface AelionProfileExportBaseOptions {
  readonly sink: WebMExportOptions['sink'];
  readonly signal?: AbortSignal;
  readonly cleanupSink?: (reason: unknown) => void | Promise<void>;
  readonly onProgress?: (progress: number) => void;
}

export type AelionProfileExportOptions =
  | (AelionProfileExportBaseOptions & {
      readonly profile: 'webm-vp9-opus' | 'mp4-h264-aac';
      readonly videoBitrate?: number;
      readonly audioBitrate?: number;
    })
  | (AelionProfileExportBaseOptions & {
      readonly profile: 'audio-wav';
      readonly sampleFormat?: 's16' | 'f32';
    })
  | (AelionProfileExportBaseOptions & {
      readonly profile: 'still-png' | 'still-jpeg' | 'still-webp';
      readonly timeUs: number;
      readonly quality?: number;
    })
  | (AelionProfileExportBaseOptions & {
      readonly profile: 'animated-gif';
      readonly loopCount?: number;
    });

export type AelionProfileExportResult =
  | WebMExportResult
  | WavExportResult
  | StillImageExportResult
  | GifExportResult;

export interface AelionTypedExportJob<TResult> extends Promise<TResult> {
  readonly id: string;
  readonly state: AelionExportJobState;
  readonly result: Promise<TResult>;
  cancel(reason?: unknown): Promise<void>;
  getSnapshot(): AelionExportJobSnapshot;
  subscribe(listener: (snapshot: AelionExportJobSnapshot) => void): () => void;
}

/**
 * A cancellable export handle. It implements Promise so existing
 * `await session.export.start(options)` consumers remain source-compatible.
 */
export type AelionExportJob = AelionTypedExportJob<WebMExportResult>;

export type AelionProfileExportJob = AelionTypedExportJob<AelionProfileExportResult>;

export interface AelionRemoteExportOptions {
  readonly profile: ExportProfileId;
  readonly provider: RemoteExportProvider;
  readonly authorizer: RemoteExportAuthorizer;
  /** Replaces the default canonical Project manifest when a provider needs extra bindings. */
  readonly manifest?: JsonObject;
  /** Overrides the content-derived idempotency key for an existing provider workflow. */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, stage?: string) => void;
}

export type AelionRemoteExportJob = AelionTypedExportJob<RemoteExportResult>;

export interface AelionPreviewApi {
  renderFrame(options: AelionPreviewOptions): Promise<RenderIrFrameResult>;
}

export interface AelionSessionStats {
  readonly schemaVersion: '1.0.0';
  readonly revision: bigint | null;
  readonly diagnostics: {
    readonly retained: number;
    readonly dropped: number;
    readonly limit: number;
  };
  readonly compile: CompileStats | null;
  readonly preview: {
    readonly requestedFrames: number;
    readonly renderedFrames: number;
    readonly failedFrames: number;
    readonly lastBackend: 'webgpu' | 'webgl2' | null;
    readonly lastWidth: number | null;
    readonly lastHeight: number | null;
    readonly lastRenderScale: number | null;
    readonly pendingFrames: number;
    readonly maxPendingFrames: number;
    readonly rendererPresent: boolean;
    readonly rendererDisposed: boolean;
    readonly workerPendingRequests: number;
    readonly workerActiveRequests: number;
    readonly workerCancelledRequests: number;
    /** Actual terminal snapshot captured before releasing the disposed renderer wrapper. */
    readonly lastDisposedRenderer: {
      readonly disposed: boolean;
      readonly pendingFrames: number;
      readonly workerDisposed: boolean;
      readonly workerPendingRequests: number;
      readonly workerActiveRequests: number;
      readonly workerCancelledRequests: number;
    } | null;
  };
  readonly player: AelionPlayerStats;
  readonly export: {
    readonly jobsStarted: number;
    readonly jobsCompleted: number;
    readonly jobsFailed: number;
    readonly jobsCancelled: number;
    readonly activeJobId: string | null;
    readonly progress: number;
  };
}

export interface AelionSessionSnapshot {
  readonly state: AelionSessionState;
  readonly revision: bigint | null;
  readonly project: Readonly<AelionProject> | null;
  readonly renderIr: RenderIr | null;
  readonly capability: CapabilityReport | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly stats: AelionSessionStats;
}

export interface AelionSessionApi {
  readonly state: AelionSessionState;
  readonly revision: bigint | null;
  readonly transaction: AelionTransactionApi;
  readonly player: AelionPlayerApi;
  readonly preview: AelionPreviewApi;
  readonly export: AelionExportApi;
  loadProject(project: unknown): Promise<void>;
  /** @deprecated Use `session.preview.renderFrame()` for new integrations. */
  renderFrame(options: AelionPreviewOptions): Promise<RenderIrFrameResult>;
  probeCapabilities(signal?: AbortSignal): Promise<CapabilityReport>;
  getSnapshot(): AelionSessionSnapshot;
  getCapabilitySnapshot(): CapabilityReport | null;
  getDiagnostics(): readonly Diagnostic[];
  getStats(): AelionSessionStats;
  subscribe(listener: (event: AelionSessionEvent) => void): () => void;
  subscribe<T extends AelionSessionEventType>(
    type: T,
    listener: (event: AelionSessionEventOf<T>) => void,
  ): () => void;
  dispose(): Promise<void>;
}

export interface AelionApi {
  createSession(options?: AelionSessionOptions): Promise<AelionSessionApi>;
}
