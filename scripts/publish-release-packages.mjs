#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { PHASE_1_EXPECTED_PUBLIC_PACKAGES } from './phase-1-evidence-lib.mjs';
import { publishWithRegistryConsistency } from './publish-release-packages-lib.mjs';
import { releaseChannelForVersion } from './release-policy.mjs';

const execFileAsync = promisify(execFile);
const manifestArgument = process.argv[2];
if (manifestArgument === undefined) {
  throw new Error('Usage: node scripts/publish-release-packages.mjs <release-manifest.json>');
}
const manifestPath = resolve(manifestArgument);
const directory = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const releaseChannel = releaseChannelForVersion(manifest.version);
if (
  manifest.schemaVersion !== '1.0.0' ||
  manifest.registry !== 'https://registry.npmjs.org/' ||
  manifest.npmDistTag !== releaseChannel.npmDistTag ||
  manifest.prerelease !== releaseChannel.prerelease ||
  manifest.tag !== `v${manifest.version}` ||
  !Array.isArray(manifest.packages) ||
  manifest.packages.length !== 13
) {
  throw new Error('Release manifest contract differs');
}
const packageNames = manifest.packages.map(entry => entry?.name);
if (
  JSON.stringify([...packageNames].sort()) !==
    JSON.stringify([...PHASE_1_EXPECTED_PUBLIC_PACKAGES].sort()) ||
  new Set(packageNames).size !== packageNames.length
) {
  throw new Error('Release manifest package set differs from the reviewed contract');
}
if (process.env.GITHUB_ACTIONS !== 'true' && process.env.AELION_ALLOW_LOCAL_PUBLISH !== '1') {
  throw new Error('Publishing is restricted to GitHub Actions unless explicitly overridden');
}
if (process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA !== manifest.sourceCommit) {
  throw new Error('GitHub source commit differs from the packed release manifest');
}

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
async function npm(args) {
  return execFileAsync(npmExecutable, args, {
    cwd: directory,
    env: { ...process.env, npm_config_registry: manifest.registry },
    encoding: 'utf8',
    maxBuffer: 16 * 1_024 * 1_024,
  });
}

async function publishedIntegrity(name, version) {
  try {
    const result = await npm([
      'view',
      `${name}@${version}`,
      'dist.integrity',
      '--json',
      '--registry',
      manifest.registry,
    ]);
    return JSON.parse(result.stdout);
  } catch (error) {
    const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
    if (/\bE404\b|not found/iu.test(output)) return undefined;
    throw error;
  }
}

const releaseEntries = [];
for (const entry of manifest.packages) {
  if (
    entry.version !== manifest.version ||
    typeof entry.file !== 'string' ||
    entry.file.length === 0 ||
    entry.file.includes('/') ||
    entry.file.includes('\\') ||
    !/^[0-9a-f]{64}$/u.test(entry.sha256) ||
    !entry.integrity?.startsWith('sha512-')
  ) {
    throw new Error(`${String(entry.name)} release entry is invalid`);
  }
  const tarball = resolve(directory, entry.file);
  const bytes = await readFile(tarball);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (sha256 !== entry.sha256 || integrity !== entry.integrity) {
    throw new Error(`${entry.name} tarball hash differs from the release manifest`);
  }
  releaseEntries.push({ ...entry, tarball });
}

await publishWithRegistryConsistency({
  entries: releaseEntries,
  publishedIntegrity: entry => publishedIntegrity(entry.name, entry.version),
  publish: entry =>
    npm([
      'publish',
      entry.tarball,
      '--access',
      'public',
      '--tag',
      manifest.npmDistTag,
      '--registry',
      manifest.registry,
      '--provenance',
    ]),
});
