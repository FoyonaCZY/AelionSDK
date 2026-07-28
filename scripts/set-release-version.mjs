#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { corepackArguments, corepackExecutable } from './corepack-command.mjs';
import { parseReleaseVersion } from './release-policy.mjs';
import {
  RELEASE_VERSION_DOCUMENTS,
  updateDocumentVersion,
  updateManifestVersion,
} from './release-version-lib.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(argument => argument !== '--');
const checkOnly = args.length === 1 && args[0] === '--check';
if (!checkOnly && args.length !== 1) {
  throw new Error('Usage: node scripts/set-release-version.mjs <version> | --check');
}

async function childManifestPaths(directoryName) {
  const directory = join(root, directoryName);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name, 'package.json'))
    .sort();
}

const manifestPaths = [
  join(root, 'package.json'),
  ...(await childManifestPaths('apps')),
  ...(await childManifestPaths('packages')),
];
const rootManifest = JSON.parse(await readFile(manifestPaths[0], 'utf8'));
const currentVersion = rootManifest.version;
parseReleaseVersion(currentVersion);
const nextVersion = checkOnly ? currentVersion : args[0];
parseReleaseVersion(nextVersion);
if (!checkOnly && nextVersion === currentVersion) {
  throw new Error(`Release version is already ${currentVersion}`);
}

const original = new Map();
for (const path of [
  ...manifestPaths,
  ...RELEASE_VERSION_DOCUMENTS.map(path => join(root, path)),
  join(root, 'pnpm-lock.yaml'),
]) {
  original.set(path, await readFile(path, 'utf8'));
}

const changed = new Map();
for (const path of manifestPaths) {
  const manifest = JSON.parse(original.get(path));
  const updated = updateManifestVersion(manifest, currentVersion, nextVersion);
  changed.set(path, `${JSON.stringify(updated, null, 2)}\n`);
}
for (const documentPath of RELEASE_VERSION_DOCUMENTS) {
  const path = join(root, documentPath);
  changed.set(
    path,
    updateDocumentVersion(original.get(path), currentVersion, nextVersion, documentPath),
  );
}

if (checkOnly) {
  process.stdout.write(
    `Release version ${currentVersion} is synchronized across ${manifestPaths.length.toString()} manifests and ${RELEASE_VERSION_DOCUMENTS.length.toString()} documents.\n`,
  );
  process.exit(0);
}

try {
  await Promise.all([...changed].map(([path, source]) => writeFile(path, source)));
  await execFileAsync(
    corepackExecutable,
    corepackArguments(['pnpm', 'install', '--lockfile-only', '--ignore-scripts']),
    {
      cwd: root,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      encoding: 'utf8',
      maxBuffer: 16 * 1_024 * 1_024,
    },
  );
  await execFileAsync(
    corepackExecutable,
    corepackArguments(['pnpm', '--filter', '@aelionsdk/sdk', 'run', 'api:snapshot:update']),
    {
      cwd: root,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      encoding: 'utf8',
      maxBuffer: 16 * 1_024 * 1_024,
    },
  );
} catch (error) {
  await Promise.all([...original].map(([path, source]) => writeFile(path, source)));
  throw error;
}

process.stdout.write(
  `Updated ${manifestPaths.length.toString()} manifests, ${RELEASE_VERSION_DOCUMENTS.length.toString()} documents, the lockfile and API snapshot from ${currentVersion} to ${nextVersion}.\n`,
);
