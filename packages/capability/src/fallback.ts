import type { Diagnostic } from '@aelionsdk/core';

export type CodecOperation = 'decode' | 'encode';
export type CodecClass = 'video' | 'audio';

/** The codec execution the SDK is being asked to perform. */
export interface CodecIdentity {
  readonly class: CodecClass;
  readonly operation: CodecOperation;
  /** WebCodecs codec string, e.g. `avc1.64001f` or `mp4a.40.2`. */
  readonly codec: string;
}

/**
 * Contract for a software codec fallback backend (e.g. a WASM decoder).
 *
 * The engine negotiates through this interface but ships no backend in 1.1:
 * an application registers one after the codec strategy is chosen. The
 * interface intentionally mirrors the WebCodecs lifecycle so a future WASM
 * adapter can implement it without reshaping the negotiation path.
 */
export interface CodecFallbackProvider {
  /** Stable provider id, e.g. `wasm-h264`. */
  readonly id: string;
  /** True when the backend is loaded and ready to accept work. */
  readonly ready: boolean;
  /** Whether this provider can execute the requested codec path. */
  supports(identity: CodecIdentity): boolean;
}

/** Negotiated execution path for a single codec operation. */
export type CodecExecutionPath =
  | { readonly path: 'hardware' }
  | { readonly path: 'fallback'; readonly providerId: string }
  | { readonly path: 'unavailable' };

export type CodecExecutionDecision = CodecExecutionPath & {
  readonly diagnostics: readonly Diagnostic[];
};

function decisionDiagnostic(code: string, message: string, recoverable: boolean): Diagnostic {
  return {
    code,
    severity: recoverable ? 'warning' : 'error',
    message,
    recoverable,
  };
}

/**
 * Negotiate how to execute a codec operation: hardware when the platform
 * reports it, otherwise the first ready provider that supports the identity,
 * otherwise fail closed with a diagnostic.
 */
export function selectCodecExecution(
  identity: CodecIdentity,
  hardwareSupported: boolean,
  providers: readonly CodecFallbackProvider[],
): CodecExecutionDecision {
  if (hardwareSupported) {
    return { path: 'hardware', diagnostics: [] };
  }
  const provider = providers.find(candidate => candidate.ready && candidate.supports(identity));
  if (provider !== undefined) {
    return {
      path: 'fallback',
      providerId: provider.id,
      diagnostics: [
        decisionDiagnostic(
          'CAPABILITY_CODEC_FALLBACK_USED',
          `${identity.class} ${identity.operation} for ${identity.codec} runs through the ${provider.id} software fallback`,
          true,
        ),
      ],
    };
  }
  return {
    path: 'unavailable',
    diagnostics: [
      decisionDiagnostic(
        'CAPABILITY_CODEC_NO_BACKEND',
        `${identity.class} ${identity.operation} for ${identity.codec} has no hardware support and no registered software fallback`,
        false,
      ),
    ],
  };
}

/** Bounded registry of software codec fallback providers. */
export class CodecFallbackRegistry {
  readonly #providers: CodecFallbackProvider[] = [];

  public register(provider: CodecFallbackProvider): void {
    if (this.#providers.some(existing => existing.id === provider.id)) {
      throw new TypeError(`Codec fallback ${provider.id} is already registered`);
    }
    this.#providers.push(provider);
  }

  public unregister(id: string): void {
    const index = this.#providers.findIndex(provider => provider.id === id);
    if (index !== -1) this.#providers.splice(index, 1);
  }

  public clear(): void {
    this.#providers.length = 0;
  }

  public providers(): readonly CodecFallbackProvider[] {
    return [...this.#providers];
  }
}

/** The default process-wide registry used when no application instance is passed. */
export const codecFallbackRegistry = new CodecFallbackRegistry();
