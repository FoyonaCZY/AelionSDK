import fc from 'fast-check';
import type { JsonValue } from '@aelion/core';
import { describe, expect, it } from 'vitest';

import {
  canonicalStringify,
  ProjectInputAdmissionError,
  snapshotProjectInput,
} from '../src/index.js';

describe('Project input admission fuzz', () => {
  it('ownership-snapshots canonical JSON and rejects non-canonical numbers', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 10 }), value => {
        try {
          const snapshot = snapshotProjectInput(value);
          if (value !== null && typeof value === 'object') expect(snapshot).not.toBe(value);
          expect(canonicalStringify(snapshot)).toBe(canonicalStringify(value as JsonValue));
        } catch (error) {
          expect(error).toBeInstanceOf(ProjectInputAdmissionError);
          expect((error as ProjectInputAdmissionError).code).toBe('PROJECT_INPUT_INVALID');
        }
      }),
      { numRuns: 1_000, endOnFailure: true },
    );
  });

  it('fails closed for non-JSON object graphs without leaking implementation errors', () => {
    fc.assert(
      fc.property(
        fc.anything({
          maxDepth: 6,
          withBigInt: true,
          withDate: true,
          withMap: true,
          withSet: true,
          withTypedArray: true,
        }),
        value => {
          try {
            canonicalStringify(snapshotProjectInput(value));
          } catch (error) {
            expect(error).toBeInstanceOf(ProjectInputAdmissionError);
          }
        },
      ),
      { numRuns: 1_000, endOnFailure: true },
    );
  });
});
