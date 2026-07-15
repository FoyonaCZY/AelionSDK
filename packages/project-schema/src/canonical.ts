import type { JsonValue } from '@aelion/core';

export class CanonicalizationError extends TypeError {
  public readonly code:
    | 'CANONICAL_UNSUPPORTED_VALUE'
    | 'CANONICAL_NON_FINITE_NUMBER'
    | 'CANONICAL_NEGATIVE_ZERO'
    | 'CANONICAL_UNSAFE_INTEGER';

  public constructor(code: CanonicalizationError['code'], message: string) {
    super(message);
    this.name = 'CanonicalizationError';
    this.code = code;
  }
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, character => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, character => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function assertCanonicalNumber(value: number, path: string): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError('CANONICAL_NON_FINITE_NUMBER', `Non-finite number at ${path}`);
  }
  if (Object.is(value, -0)) {
    throw new CanonicalizationError('CANONICAL_NEGATIVE_ZERO', `Negative zero at ${path}`);
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new CanonicalizationError('CANONICAL_UNSAFE_INTEGER', `Unsafe integer at ${path}`);
  }
}

function encode(value: JsonValue, path: string): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assertCanonicalNumber(value, path);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => encode(entry, `${path}/${index}`)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys
      .map(key => `${JSON.stringify(key)}:${encode(value[key] as JsonValue, `${path}/${key}`)}`)
      .join(',')}}`;
  }

  throw new CanonicalizationError('CANONICAL_UNSUPPORTED_VALUE', `Unsupported value at ${path}`);
}

export function canonicalStringify(value: JsonValue): string {
  return encode(value, '$');
}

export async function canonicalHash(value: JsonValue): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `sha256:${hex}`;
}

export function canonicalClone<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}
