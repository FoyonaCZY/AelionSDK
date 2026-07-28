#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compatibilityMatrixReasons } from './compatibility-matrix-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const matrix = JSON.parse(await readFile(join(root, 'compatibility', 'matrix.v1.json'), 'utf8'));
const sdkVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const reasons = compatibilityMatrixReasons(matrix, sdkVersion);
for (const entry of [...(matrix.environments ?? []), ...(matrix.axes ?? [])]) {
  for (const evidence of entry.evidence ?? []) {
    try {
      await access(join(root, evidence));
    } catch {
      reasons.push(`${entry.id} evidence does not exist: ${evidence}`);
    }
  }
}
if (reasons.length > 0) {
  throw new Error(`Compatibility matrix is invalid:\n- ${reasons.join('\n- ')}`);
}
process.stdout.write(
  `Compatibility matrix ${matrix.schemaVersion} matches ${sdkVersion} and all evidence paths exist.\n`,
);
