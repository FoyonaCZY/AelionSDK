import type { JsonValue } from '@aelionsdk/core';

import { snapshotProjectInput } from './admission.js';
import type { AelionProject } from './types.js';

/** Immutable schema URI emitted by AelionSDK before the 1.2 remediation. */
export const LEGACY_PROJECT_SCHEMA_URI = 'https://schemas.aelion.dev/project/v1.json';
/** Version paired with the immutable legacy Project schema URI. */
export const LEGACY_PROJECT_SCHEMA_VERSION = '1.0.0';
/** Canonical schema URI for Projects containing the admitted 1.2 additions. */
export const CURRENT_PROJECT_SCHEMA_URI = 'https://schemas.aelion.dev/project/v1.2.json';
/** Version paired with the canonical Project v1.2 schema URI. */
export const CURRENT_PROJECT_SCHEMA_VERSION = '1.2.0';

/** Result of isolating and, when necessary, migrating a Project identity. */
export interface ProjectIdentityMigration {
  readonly project: AelionProject;
  readonly migrated: boolean;
  readonly fromSchema?: string;
  readonly fromVersion?: string;
  readonly toSchema: typeof CURRENT_PROJECT_SCHEMA_URI;
  readonly toVersion: typeof CURRENT_PROJECT_SCHEMA_VERSION;
}

function object(value: JsonValue): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/** @internal The value must already be an ownership-isolated admission snapshot. */
export function migrateAdmittedProjectToCurrent(value: JsonValue): ProjectIdentityMigration {
  const project = object(value);
  if (project === undefined) {
    return {
      project: value as unknown as AelionProject,
      migrated: false,
      toSchema: CURRENT_PROJECT_SCHEMA_URI,
      toVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    };
  }
  const fromSchema = typeof project.$schema === 'string' ? project.$schema : undefined;
  const fromVersion = typeof project.schemaVersion === 'string' ? project.schemaVersion : undefined;
  const legacy =
    fromSchema === LEGACY_PROJECT_SCHEMA_URI && fromVersion === LEGACY_PROJECT_SCHEMA_VERSION;
  if (legacy) {
    project.$schema = CURRENT_PROJECT_SCHEMA_URI;
    project.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION;
  }
  return {
    project: project as unknown as AelionProject,
    migrated: legacy,
    ...(fromSchema === undefined ? {} : { fromSchema }),
    ...(fromVersion === undefined ? {} : { fromVersion }),
    toSchema: CURRENT_PROJECT_SCHEMA_URI,
    toVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  };
}

/**
 * Capture an ownership-isolated Project snapshot and upgrade the ambiguous
 * v1/1.0 identity emitted by AelionSDK 1.1/1.2 RCs to the immutable v1.2
 * identity. Content is preserved byte-for-byte at the JSON-value level.
 */
export function migrateProjectToCurrent(value: unknown): ProjectIdentityMigration {
  const snapshot = snapshotProjectInput(value);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Project migration requires a JSON object');
  }
  return migrateAdmittedProjectToCurrent(snapshot);
}
