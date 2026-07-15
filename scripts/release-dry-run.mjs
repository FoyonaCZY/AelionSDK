#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packagesDirectory = join(root, 'packages');
const expectedVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const published = [];
const npmCache = await mkdtemp(join(tmpdir(), 'aelion-npm-dry-run-'));

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
    if (manifest.private === true || !manifest.name?.startsWith('@aelion/')) continue;
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
    const { stdout, stderr } = await execFileAsync(
      'corepack',
      ['pnpm', 'publish', '--dry-run', '--no-git-checks'],
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
