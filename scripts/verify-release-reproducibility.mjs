#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'aelion-release-reproducibility-'));
const firstDirectory = join(temporaryDirectory, 'first');
const secondDirectory = join(temporaryDirectory, 'second');

async function prepare(outputDirectory) {
  await mkdir(outputDirectory);
  await execFileAsync(
    process.execPath,
    [join(root, 'scripts', 'prepare-release-packages.mjs'), outputDirectory],
    {
      cwd: root,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      encoding: 'utf8',
      maxBuffer: 16 * 1_024 * 1_024,
    },
  );
  return JSON.parse(await readFile(join(outputDirectory, 'release-manifest.json'), 'utf8'));
}

try {
  const first = await prepare(firstDirectory);
  const second = await prepare(secondDirectory);
  const firstByName = new Map(first.packages.map(entry => [entry.name, entry]));
  const differences = second.packages
    .filter(entry => {
      const previous = firstByName.get(entry.name);
      return (
        previous === undefined ||
        previous.version !== entry.version ||
        previous.file !== entry.file ||
        previous.bytes !== entry.bytes ||
        previous.sha256 !== entry.sha256 ||
        previous.integrity !== entry.integrity
      );
    })
    .map(entry => entry.name);
  if (
    first.version !== second.version ||
    first.tag !== second.tag ||
    first.sourceCommit !== second.sourceCommit ||
    first.packages.length !== second.packages.length ||
    differences.length > 0
  ) {
    throw new Error(
      `Release tarballs are not byte reproducible${differences.length === 0 ? '' : `: ${differences.join(', ')}`}`,
    );
  }
  process.stdout.write(
    `Release reproducibility passed for ${first.packages.length.toString()} packages at ${first.version}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
