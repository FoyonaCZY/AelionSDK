#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const nodeVersion = (await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim();
const fixtures = JSON.parse(
  await readFile(new URL('../fixtures/manifests/media-v1.json', import.meta.url), 'utf8'),
);

if (process.version !== `v${nodeVersion}`) {
  throw new Error(`Expected Node ${nodeVersion}, received ${process.version}`);
}
if (!String(packageJson.packageManager).startsWith('pnpm@10.13.1')) {
  throw new Error('packageManager must pin pnpm 10.13.1');
}
if (!lockfile.includes('lockfileVersion:')) throw new Error('pnpm lockfile is missing');
if (!Array.isArray(fixtures.fixtures) || fixtures.fixtures.length < 5) {
  throw new Error('Hermetic media fixture corpus is incomplete');
}
console.log(
  `Environment contract verified: ${process.version}, ${packageJson.packageManager}, ${fixtures.fixtures.length} media fixtures.`,
);
