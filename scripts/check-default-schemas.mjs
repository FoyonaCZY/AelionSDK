#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'packages', 'sdk', 'src', 'default-schemas.ts');
const write = process.argv.includes('--write');

async function canonicalJson(path) {
  return JSON.stringify(JSON.parse(await readFile(resolve(root, path), 'utf8')));
}

const [projectSchema, previousProjectSchema, legacyProjectSchema, materialInstanceSchema] =
  await Promise.all([
    canonicalJson('schemas/project/v2.0/project.schema.json'),
    canonicalJson('schemas/project/v1.2/project.schema.json'),
    canonicalJson('schemas/project/v1/project.schema.json'),
    canonicalJson('schemas/material/v1/instance.schema.json'),
  ]);

const expected = `import type { JsonObject } from '@aelionsdk/core';

import type { AelionProjectSchemas } from './types.js';

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

const projectSchema = JSON.parse(
  String.raw\`${projectSchema}\`,
) as JsonObject;
const previousProjectSchema = JSON.parse(
  String.raw\`${previousProjectSchema}\`,
) as JsonObject;
const legacyProjectSchema = JSON.parse(
  String.raw\`${legacyProjectSchema}\`,
) as JsonObject;
const materialInstanceSchema = JSON.parse(
  String.raw\`${materialInstanceSchema}\`,
) as JsonObject;

/**
 * The canonical Project validators bundled into the JavaScript artifact. Consumers
 * can create a session without loading schema files or configuring asset URLs.
 */
export const defaultSchemas: AelionProjectSchemas = Object.freeze({
  project: deepFreeze(projectSchema),
  previousProject: deepFreeze(previousProjectSchema),
  legacyProject: deepFreeze(legacyProjectSchema),
  materialInstance: deepFreeze(materialInstanceSchema),
});
`;

if (write) {
  await writeFile(outputPath, expected);
  process.stdout.write('Updated packages/sdk/src/default-schemas.ts\n');
} else if ((await readFile(outputPath, 'utf8')) !== expected) {
  throw new Error(
    'Bundled SDK schemas drifted from schemas/**/*.json. Run `corepack pnpm schemas:update` and review the protocol change.',
  );
} else {
  process.stdout.write(
    'Bundled SDK schemas match canonical current, immutable v1.2/v1 Project, and Material Instance JSON\n',
  );
}
