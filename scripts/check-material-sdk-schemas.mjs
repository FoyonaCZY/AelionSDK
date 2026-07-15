#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'packages', 'material-sdk', 'src', 'bundled-schemas.ts');
const write = process.argv.includes('--write');

async function canonicalJson(path) {
  return JSON.stringify(JSON.parse(await readFile(resolve(root, path), 'utf8')));
}

const [packageSchema, definitionSchema, graphSchema] = await Promise.all([
  canonicalJson('schemas/material/v1/package.schema.json'),
  canonicalJson('schemas/material/v1/definition.schema.json'),
  canonicalJson('schemas/material/v1/graph.schema.json'),
]);

const expected = `import type { JsonObject } from '@aelion/core';

export const materialPackageSchema = JSON.parse(
  String.raw\`${packageSchema}\`,
) as JsonObject;

export const materialDefinitionSchema = JSON.parse(
  String.raw\`${definitionSchema}\`,
) as JsonObject;

export const materialGraphSchema = JSON.parse(
  String.raw\`${graphSchema}\`,
) as JsonObject;
`;

if (write) {
  await writeFile(outputPath, expected);
  process.stdout.write('Updated packages/material-sdk/src/bundled-schemas.ts\n');
} else if ((await readFile(outputPath, 'utf8')) !== expected) {
  throw new Error(
    'Bundled Material SDK schemas drifted from schemas/material/v1. Run `node scripts/check-material-sdk-schemas.mjs --write` and review the protocol change.',
  );
} else {
  process.stdout.write('Bundled Material SDK schemas match canonical Material v1 JSON\n');
}
