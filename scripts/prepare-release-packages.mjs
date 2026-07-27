#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PHASE_1_EXPECTED_PUBLIC_PACKAGES } from './phase-1-evidence-lib.mjs';
import { corepackArguments, corepackExecutable } from './corepack-command.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = join(root, 'packages');
const outputArguments = process.argv.slice(2).filter(argument => argument !== '--');
const outputArgument = outputArguments[0];
if (outputArgument === undefined || outputArguments.length !== 1) {
  throw new Error('Usage: node scripts/prepare-release-packages.mjs <empty-output-directory>');
}
const outputDirectory = isAbsolute(outputArgument)
  ? resolve(outputArgument)
  : resolve(root, outputArgument);
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = rootManifest.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error(`Root version is not publishable SemVer: ${String(version)}`);
}
const expectedTag = `v${version}`;
if (
  process.env.AELION_RELEASE_TAG !== undefined &&
  process.env.AELION_RELEASE_TAG !== expectedTag
) {
  throw new Error(
    `Release tag ${process.env.AELION_RELEASE_TAG} does not match package version ${expectedTag}`,
  );
}

await mkdir(outputDirectory, { recursive: true });
const existingFiles = await readdir(outputDirectory);
if (existingFiles.length > 0) {
  throw new Error(`Release output directory must be empty: ${outputDirectory}`);
}

const entries = [];
for (const directoryName of (await readdir(packagesRoot)).sort()) {
  const directory = join(packagesRoot, directoryName);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  if (manifest.private === true || !manifest.name?.startsWith('@aelion/')) continue;
  if (manifest.version !== version) {
    throw new Error(`${manifest.name} version ${String(manifest.version)} differs from ${version}`);
  }
  if (
    manifest.license !== 'MIT' ||
    manifest.publishConfig?.access !== 'public' ||
    manifest.publishConfig?.provenance !== true
  ) {
    throw new Error(`${manifest.name} publish metadata is incomplete`);
  }
  if (
    manifest.repository?.url !== 'git+https://github.com/FoyonaCZY/AelionSDK.git' ||
    manifest.repository?.directory !== `packages/${directoryName}`
  ) {
    throw new Error(`${manifest.name} repository metadata differs`);
  }
  entries.push({ directory, manifest });
}

const packageNames = entries.map(entry => entry.manifest.name).sort();
if (JSON.stringify(packageNames) !== JSON.stringify([...PHASE_1_EXPECTED_PUBLIC_PACKAGES].sort())) {
  throw new Error('Public package set differs from the reviewed release contract');
}

const pending = new Map(entries.map(entry => [entry.manifest.name, entry]));
const ordered = [];
while (pending.size > 0) {
  const ready = [...pending.values()]
    .filter(entry =>
      Object.keys(entry.manifest.dependencies ?? {})
        .filter(name => pending.has(name))
        .every(name => !pending.has(name) || ordered.some(value => value.manifest.name === name)),
    )
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
  if (ready.length === 0) {
    throw new Error(`Circular public package dependencies: ${[...pending.keys()].join(', ')}`);
  }
  for (const entry of ready) {
    pending.delete(entry.manifest.name);
    ordered.push(entry);
  }
}

const sourceCommit = (
  await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
).stdout.trim();
const releasePackages = [];
for (const entry of ordered) {
  const packed = await execFileAsync(
    corepackExecutable,
    corepackArguments(['pnpm', 'pack', '--pack-destination', outputDirectory]),
    {
      cwd: entry.directory,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      encoding: 'utf8',
      maxBuffer: 16 * 1_024 * 1_024,
    },
  );
  const emitted = `${packed.stdout}\n${packed.stderr}`
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.endsWith('.tgz'));
  if (emitted === undefined) throw new Error(`No tarball emitted for ${entry.manifest.name}`);
  const tarball = isAbsolute(emitted) ? resolve(emitted) : resolve(entry.directory, emitted);
  const bytes = await readFile(tarball);
  const fileName = relative(outputDirectory, tarball).replaceAll('\\', '/');
  if (fileName.startsWith('../') || fileName.includes('/')) {
    throw new Error(`${entry.manifest.name} tarball was emitted outside the release directory`);
  }
  releasePackages.push({
    name: entry.manifest.name,
    version,
    file: fileName,
    bytes: (await stat(tarball)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  });
}

const releaseManifest = {
  schemaVersion: '1.0.0',
  version,
  tag: expectedTag,
  npmDistTag: 'next',
  registry: 'https://registry.npmjs.org/',
  sourceCommit,
  packages: releasePackages,
};
await writeFile(
  join(outputDirectory, 'release-manifest.json'),
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
);
process.stdout.write(
  `Prepared ${releasePackages.length.toString()} packages for ${expectedTag} in ${outputDirectory}\n`,
);
