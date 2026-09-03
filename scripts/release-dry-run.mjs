#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { corepackArguments, corepackExecutable } from './corepack-command.mjs';
import { releaseChannelForVersion } from './release-policy.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packagesDirectory = join(root, 'packages');
const expectedVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const releaseChannel = releaseChannelForVersion(expectedVersion);
const published = [];
const npmCache = await mkdtemp(join(tmpdir(), 'aelion-npm-dry-run-'));

function npmCommand(args) {
  if (process.platform !== 'win32') return { executable: 'npm', args };
  // Node 24 no longer spawns .cmd shims directly with execFile on Windows.
  // Keep the shell command and every argument separate; all arguments here
  // come from the repository's validated package manifests.
  return {
    executable: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', ...args],
  };
}

async function registryIntegrity(name, version) {
  try {
    const command = npmCommand(['view', `${name}@${version}`, 'dist.integrity', '--json']);
    const { stdout } = await execFileAsync(command.executable, command.args, {
      cwd: root,
      env: { ...process.env, npm_config_cache: npmCache },
      encoding: 'utf8',
    });
    return JSON.parse(stdout);
  } catch (error) {
    const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
    if (/\bE404\b|not found/iu.test(output)) return undefined;
    throw error;
  }
}

async function packedIntegrity(packageDirectory) {
  const { stdout, stderr } = await execFileAsync(
    corepackExecutable,
    corepackArguments(['pnpm', 'pack', '--pack-destination', npmCache]),
    {
      cwd: packageDirectory,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      encoding: 'utf8',
      maxBuffer: 16 * 1_024 * 1_024,
    },
  );
  const emitted = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.endsWith('.tgz'));
  if (emitted === undefined) throw new Error('pnpm pack did not emit a tarball');
  const tarball = isAbsolute(emitted) ? emitted : resolve(packageDirectory, emitted);
  const bytes = await readFile(tarball);
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

try {
  for (const directoryName of (await readdir(packagesDirectory)).sort()) {
    const packageDirectory = join(packagesDirectory, directoryName);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private === true || !manifest.name?.startsWith('@aelionsdk/')) continue;
    if (manifest.version !== expectedVersion) {
      throw new Error(
        `${manifest.name} version ${String(manifest.version)} does not match ${expectedVersion}`,
      );
    }
    if (
      manifest.publishConfig?.access !== 'public' ||
      manifest.publishConfig?.provenance !== true
    ) {
      throw new Error(`${manifest.name} must declare public access and npm provenance`);
    }
    const existingIntegrity = await registryIntegrity(manifest.name, manifest.version);
    if (existingIntegrity !== undefined) {
      const localIntegrity = await packedIntegrity(packageDirectory);
      if (localIntegrity !== existingIntegrity) {
        throw new Error(
          `${manifest.name}@${manifest.version} is already published with different bytes`,
        );
      }
      published.push(`${manifest.name}@${manifest.version} (registry match)`);
      continue;
    }
    const { stdout, stderr } = await execFileAsync(
      corepackExecutable,
      corepackArguments([
        'pnpm',
        'publish',
        '--dry-run',
        '--no-git-checks',
        '--tag',
        releaseChannel.npmDistTag,
      ]),
      {
        cwd: packageDirectory,
        env: {
          ...process.env,
          COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
          npm_config_cache: npmCache,
        },
        maxBuffer: 16 * 1_024 * 1_024,
      },
    );
    const output = `${stdout}\n${stderr}`;
    if (!output.includes(`+ ${manifest.name}@${manifest.version}`)) {
      throw new Error(`${manifest.name} did not complete npm publish --dry-run`);
    }
    published.push(`${manifest.name}@${manifest.version}`);
  }
} finally {
  await rm(npmCache, { recursive: true, force: true });
}

if (published.length === 0) throw new Error('No public Aelion packages were checked');
process.stdout.write(`Release dry-run passed: ${published.join(', ')}\n`);
