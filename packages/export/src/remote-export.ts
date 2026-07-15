import { AelionError, throwIfAborted, type JsonObject } from '@aelion/core';

import type { ExportProfileId } from './profiles.js';

export interface RemoteExportAuthorization {
  readonly scheme: string;
  readonly token: string;
  readonly expiresAtMs?: number;
}

export interface RemoteExportAuthorizer {
  authorize(signal?: AbortSignal): Promise<RemoteExportAuthorization>;
}

export interface RemoteExportRequest {
  readonly contentId: string;
  readonly idempotencyKey: string;
  readonly profileId: ExportProfileId;
  readonly projectId: string;
  readonly sequenceId: string;
  readonly revision: string;
  readonly manifest: JsonObject;
}

export type RemoteExportEvent =
  | { readonly type: 'progress'; readonly progress: number; readonly stage?: string }
  | {
      readonly type: 'completed';
      readonly result: RemoteExportResult;
    };

export interface RemoteExportResult {
  readonly providerJobId: string;
  readonly contentId: string;
  readonly profileId: ExportProfileId;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly outputUrl?: string;
  readonly outputToken?: string;
}

export interface RemoteExportSession {
  readonly providerJobId: string;
  readonly events: AsyncIterable<RemoteExportEvent>;
  cancel(reason?: unknown): Promise<void>;
  cleanup(reason?: unknown): Promise<void>;
}

export interface RemoteExportProvider {
  readonly id: string;
  start(
    request: RemoteExportRequest,
    authorization: RemoteExportAuthorization,
    signal?: AbortSignal,
  ): Promise<RemoteExportSession>;
}

export interface RunRemoteExportOptions {
  readonly provider: RemoteExportProvider;
  readonly authorizer: RemoteExportAuthorizer;
  readonly request: RemoteExportRequest;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, stage?: string) => void;
}

function boundedProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export async function runRemoteExport(
  options: RunRemoteExportOptions,
): Promise<RemoteExportResult> {
  throwIfAborted(options.signal, 'Remote export');
  const authorization = await options.authorizer.authorize(options.signal);
  throwIfAborted(options.signal, 'Remote export');
  if (authorization.scheme.length === 0 || authorization.token.length === 0) {
    throw new AelionError([
      {
        code: 'REMOTE_EXPORT_AUTH_INVALID',
        severity: 'error',
        message: 'Remote export authorization is empty',
        recoverable: true,
      },
    ]);
  }
  if (authorization.expiresAtMs !== undefined && authorization.expiresAtMs <= Date.now()) {
    throw new AelionError([
      {
        code: 'REMOTE_EXPORT_AUTH_EXPIRED',
        severity: 'error',
        message: 'Remote export authorization has expired',
        recoverable: true,
      },
    ]);
  }
  let session: RemoteExportSession | undefined;
  let lastProgress = 0;
  try {
    session = await options.provider.start(options.request, authorization, options.signal);
    for await (const event of session.events) {
      throwIfAborted(options.signal, 'Remote export');
      if (event.type === 'progress') {
        const progress = boundedProgress(event.progress);
        if (progress < lastProgress) {
          throw new Error('Remote export progress must be monotonic');
        }
        lastProgress = progress;
        options.onProgress?.(progress, event.stage);
        continue;
      }
      if (
        event.result.providerJobId !== session.providerJobId ||
        event.result.contentId !== options.request.contentId ||
        event.result.profileId !== options.request.profileId
      ) {
        throw new Error('Remote export result identity does not match the request');
      }
      options.onProgress?.(1, 'completed');
      return event.result;
    }
    throw new Error('Remote export event stream ended without a result');
  } catch (cause) {
    await Promise.resolve(session?.cancel(cause)).catch(() => undefined);
    await Promise.resolve(session?.cleanup(cause)).catch(() => undefined);
    if (cause instanceof AelionError) throw cause;
    throw new AelionError([
      {
        code: options.signal?.aborted === true ? 'OPERATION_ABORTED' : 'REMOTE_EXPORT_FAILED',
        severity: 'error',
        message:
          options.signal?.aborted === true
            ? 'Remote export was aborted'
            : cause instanceof Error
              ? cause.message
              : 'Remote export failed',
        recoverable: true,
        cause,
      },
    ]);
  }
}

export async function createRemoteExportContentId(
  canonicalManifestBytes: Uint8Array,
  profileId: ExportProfileId,
  revision: string,
): Promise<string> {
  const prefix = new TextEncoder().encode(`${profileId}\n${revision}\n`);
  const bytes = new Uint8Array(prefix.byteLength + canonicalManifestBytes.byteLength);
  bytes.set(prefix);
  bytes.set(canonicalManifestBytes, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}
