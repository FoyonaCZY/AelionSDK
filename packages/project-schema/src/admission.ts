import type { JsonValue } from '@aelion/core';

export const PROJECT_INPUT_MAX_DEPTH = 64;
export const PROJECT_INPUT_MAX_NODES = 262_144;
export const PROJECT_INPUT_MAX_ARRAY_LENGTH = 16_384;
export const PROJECT_INPUT_MAX_OBJECT_KEYS = 4_096;
export const PROJECT_INPUT_MAX_PROPERTY_KEY_BYTES = 16 * 1_024;
export const PROJECT_INPUT_MAX_STRING_BYTES = 4 * 1_024 * 1_024;
export const PROJECT_INPUT_MAX_TOTAL_STRING_BYTES = 16 * 1_024 * 1_024;

type ProjectAdmissionCode = 'PROJECT_INPUT_INVALID' | 'PROJECT_INPUT_LIMIT_EXCEEDED';

interface PathNode {
  readonly parent: PathNode | null;
  readonly segment: string | number;
}

interface AdmissionTask {
  readonly value: unknown;
  readonly target: Record<string | number, unknown>;
  readonly key: string | number;
  readonly path: PathNode | null;
  readonly depth: number;
}

const arrayIsArray = Array.isArray;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf as (value: object) => object | null;
const ownKeys = Reflect.ownKeys;
const reflectApply = Reflect.apply;
const functionToString = (value: object): string =>
  // Calling through Reflect.apply deliberately avoids observing value.toString.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  reflectApply(Function.prototype.toString, value, []);
const textEncoder = new TextEncoder();

export class ProjectInputAdmissionError extends TypeError {
  public readonly code: ProjectAdmissionCode;
  public readonly path: readonly (string | number)[];

  public constructor(
    code: ProjectAdmissionCode,
    message: string,
    path: readonly (string | number)[],
  ) {
    super(message);
    this.name = 'ProjectInputAdmissionError';
    this.code = code;
    this.path = path;
  }
}

function pathSegments(path: PathNode | null): readonly (string | number)[] {
  const segments: (string | number)[] = [];
  for (let current = path; current !== null; current = current.parent) {
    segments.push(current.segment);
  }
  return segments.reverse();
}

function invalid(path: PathNode | null, message: string): never {
  throw new ProjectInputAdmissionError('PROJECT_INPUT_INVALID', message, pathSegments(path));
}

function limit(path: PathNode | null, message: string): never {
  throw new ProjectInputAdmissionError('PROJECT_INPUT_LIMIT_EXCEEDED', message, pathSegments(path));
}

function descriptor(value: object, key: PropertyKey, path: PathNode | null): PropertyDescriptor {
  let result: PropertyDescriptor | undefined;
  try {
    result = getOwnPropertyDescriptor(value, key);
  } catch {
    invalid(path, 'Project input contains an inaccessible property');
  }
  if (result === undefined || !('value' in result) || result.enumerable !== true) {
    invalid(path, 'Project input properties must be enumerable own data properties');
  }
  return result;
}

function arrayLength(value: unknown[], path: PathNode | null): number {
  let result: PropertyDescriptor | undefined;
  try {
    result = getOwnPropertyDescriptor(value, 'length');
  } catch {
    invalid(path, 'Project input contains an inaccessible array length');
  }
  if (result === undefined || !('value' in result) || !Number.isSafeInteger(result.value)) {
    invalid(path, 'Project input array length must be a safe own data property');
  }
  const length = Number(result.value);
  if (length < 0) invalid(path, 'Project input array length must be non-negative');
  if (length > PROJECT_INPUT_MAX_ARRAY_LENGTH) {
    limit(path, `Project input array exceeds ${PROJECT_INPUT_MAX_ARRAY_LENGTH.toString()} values`);
  }
  return length;
}

function inspectedPrototype(value: object, path: PathNode | null): object | null {
  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
  } catch {
    invalid(path, 'Project input contains an inaccessible prototype');
  }
  return prototype;
}

function inspectedDescriptor(
  value: object,
  key: PropertyKey,
  path: PathNode | null,
): PropertyDescriptor | undefined {
  try {
    return getOwnPropertyDescriptor(value, key);
  } catch {
    invalid(path, 'Project input contains an inaccessible prototype property');
  }
}

function isNativeConstructorFor(
  prototype: object,
  expectedName: 'Array' | 'Object',
  path: PathNode | null,
): boolean {
  const constructorDescriptor = inspectedDescriptor(prototype, 'constructor', path);
  if (
    constructorDescriptor === undefined ||
    !('value' in constructorDescriptor) ||
    constructorDescriptor.enumerable !== false ||
    typeof constructorDescriptor.value !== 'function'
  ) {
    return false;
  }
  const constructor = constructorDescriptor.value as object;
  const prototypeDescriptor = inspectedDescriptor(constructor, 'prototype', path);
  if (
    prototypeDescriptor === undefined ||
    !('value' in prototypeDescriptor) ||
    prototypeDescriptor.value !== prototype
  ) {
    return false;
  }
  let source: string;
  try {
    source = functionToString(constructor);
  } catch {
    return false;
  }
  return source.replaceAll(/\s+/gu, ' ') === `function ${expectedName}() { [native code] }`;
}

function isPlainObjectPrototype(prototype: object, path: PathNode | null): boolean {
  return (
    inspectedPrototype(prototype, path) === null &&
    isNativeConstructorFor(prototype, 'Object', path)
  );
}

function recordPrototype(value: object, kind: 'array' | 'object', path: PathNode | null): void {
  const prototype = inspectedPrototype(value, path);
  if (prototype === null) return;
  const accepted =
    kind === 'object'
      ? prototype === Object.prototype || isPlainObjectPrototype(prototype, path)
      : prototype === Array.prototype ||
        (arrayIsArray(prototype) &&
          isNativeConstructorFor(prototype, 'Array', path) &&
          (() => {
            const parent = inspectedPrototype(prototype, path);
            return parent !== null && isPlainObjectPrototype(parent, path);
          })());
  if (!accepted) {
    invalid(path, 'Project input must contain only plain JSON objects and arrays');
  }
}

function inspectedKeys(value: object, path: PathNode | null): readonly PropertyKey[] {
  let keys: readonly PropertyKey[];
  try {
    keys = ownKeys(value);
  } catch {
    invalid(path, 'Project input contains inaccessible properties');
  }
  return keys;
}

function byteLength(value: string, maximum: number, path: PathNode | null, scope: string): number {
  // A UTF-16 code unit contributes at least one UTF-8 byte, so this cheap
  // preflight avoids allocating a multi-megabyte encoded copy for obviously
  // oversized attacker-controlled strings. JSON escaping can expand the
  // canonical document further, but this admission budget is explicitly the
  // decoded UTF-8 payload budget rather than a serialized-file-size limit.
  if (value.length > maximum) limit(path, `${scope} exceeds ${maximum.toString()} UTF-8 bytes`);
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes > maximum) limit(path, `${scope} exceeds ${maximum.toString()} UTF-8 bytes`);
  return bytes;
}

function assign(
  target: Record<string | number, unknown>,
  key: string | number,
  value: unknown,
): void {
  defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

/**
 * Captures a bounded, ownership-isolated JSON snapshot before Ajv or semantic
 * validation sees caller-controlled objects. Reflection on a Proxy can still
 * invoke its traps; failures are caught, and no accessor getter or iterator is
 * intentionally called. After this function returns, the original value is no
 * longer observed.
 */
export function snapshotProjectInput(value: unknown): JsonValue {
  const holder: Record<string | number, unknown> = {};
  const tasks: AdmissionTask[] = [{ value, target: holder, key: 'value', path: null, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let totalStringBytes = 0;

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) break;
    nodes += 1;
    if (nodes > PROJECT_INPUT_MAX_NODES) {
      limit(task.path, `Project input exceeds ${PROJECT_INPUT_MAX_NODES.toString()} JSON values`);
    }
    if (task.depth > PROJECT_INPUT_MAX_DEPTH) {
      limit(task.path, `Project input exceeds depth ${PROJECT_INPUT_MAX_DEPTH.toString()}`);
    }

    const current = task.value;
    if (current === null || typeof current === 'boolean') {
      assign(task.target, task.key, current);
      continue;
    }
    if (typeof current === 'number') {
      if (
        !Number.isFinite(current) ||
        Object.is(current, -0) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current))
      ) {
        invalid(task.path, 'Project input contains a non-canonical number');
      }
      assign(task.target, task.key, current);
      continue;
    }
    if (typeof current === 'string') {
      totalStringBytes += byteLength(
        current,
        PROJECT_INPUT_MAX_STRING_BYTES,
        task.path,
        'Project input string',
      );
      if (totalStringBytes > PROJECT_INPUT_MAX_TOTAL_STRING_BYTES) {
        limit(
          task.path,
          `Project input strings exceed ${PROJECT_INPUT_MAX_TOTAL_STRING_BYTES.toString()} total UTF-8 bytes`,
        );
      }
      assign(task.target, task.key, current);
      continue;
    }
    if (typeof current !== 'object') {
      invalid(task.path, 'Project input contains a non-JSON value');
    }
    if (seen.has(current)) invalid(task.path, 'Project input contains a cycle or shared object');
    seen.add(current);

    if (arrayIsArray(current)) {
      recordPrototype(current, 'array', task.path);
      const length = arrayLength(current, task.path);
      const keys = inspectedKeys(current, task.path);
      if (keys.length !== length + 1) {
        invalid(task.path, 'Project input arrays must be dense and contain no extra properties');
      }
      const remaining = new Set<string>();
      for (const key of keys) {
        if (typeof key !== 'string') {
          invalid(task.path, 'Project input arrays must contain only numeric index properties');
        }
        remaining.add(key);
      }
      if (!remaining.delete('length')) {
        invalid(task.path, 'Project input arrays must be dense and contain no extra properties');
      }
      for (let index = 0; index < length; index += 1) {
        if (!remaining.delete(index.toString())) {
          invalid(task.path, 'Project input arrays must be dense and contain no extra properties');
        }
      }
      if (remaining.size !== 0) {
        invalid(task.path, 'Project input arrays must be dense and contain no extra properties');
      }
      const output: unknown[] = [];
      defineProperty(output, 'length', { value: length, writable: true });
      assign(task.target, task.key, output);
      for (let index = length - 1; index >= 0; index -= 1) {
        const key = index.toString();
        const path = { parent: task.path, segment: index };
        tasks.push({
          value: descriptor(current, key, path).value,
          target: output as unknown as Record<number, unknown>,
          key: index,
          path,
          depth: task.depth + 1,
        });
      }
      continue;
    }

    recordPrototype(current, 'object', task.path);
    const keys = inspectedKeys(current, task.path);
    if (keys.length > PROJECT_INPUT_MAX_OBJECT_KEYS) {
      limit(
        task.path,
        `Project input object exceeds ${PROJECT_INPUT_MAX_OBJECT_KEYS.toString()} properties`,
      );
    }
    const output: Record<string | number, unknown> = {};
    assign(task.target, task.key, output);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (typeof key !== 'string') invalid(task.path, 'Project input contains a symbol property');
      const path = { parent: task.path, segment: key };
      totalStringBytes += byteLength(
        key,
        PROJECT_INPUT_MAX_PROPERTY_KEY_BYTES,
        path,
        'Project input property key',
      );
      if (totalStringBytes > PROJECT_INPUT_MAX_TOTAL_STRING_BYTES) {
        limit(
          path,
          `Project input strings exceed ${PROJECT_INPUT_MAX_TOTAL_STRING_BYTES.toString()} total UTF-8 bytes`,
        );
      }
      tasks.push({
        value: descriptor(current, key, path).value,
        target: output,
        key,
        path,
        depth: task.depth + 1,
      });
    }
  }

  return holder.value as JsonValue;
}
