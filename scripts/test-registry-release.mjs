#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { PHASE_1_EXPECTED_PUBLIC_PACKAGES } from './phase-1-evidence-lib.mjs';

const execFileAsync = promisify(execFile);
const version = process.argv[2];
if (version === undefined) {
  throw new Error('Usage: node scripts/test-registry-release.mjs <version>');
}
const registry = 'https://registry.npmjs.org/';
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'aelion-registry-smoke-'));

async function run(command, args) {
  return execFileAsync(command, args, {
    cwd: temporaryDirectory,
    env: { ...process.env, npm_config_registry: registry },
    encoding: 'utf8',
    maxBuffer: 16 * 1_024 * 1_024,
  });
}

async function walk(directory) {
  const files = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

try {
  await writeFile(
    join(temporaryDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'aelion-registry-release-smoke',
        private: true,
        type: 'module',
        dependencies: {
          ...Object.fromEntries(PHASE_1_EXPECTED_PUBLIC_PACKAGES.map(name => [name, version])),
          vite: '7.0.6',
        },
      },
      null,
      2,
    )}\n`,
  );
  await run(npmExecutable, [
    'install',
    '--ignore-scripts',
    '--package-lock=false',
    '--registry',
    registry,
  ]);

  for (const name of PHASE_1_EXPECTED_PUBLIC_PACKAGES) {
    const packageRoot = join(temporaryDirectory, 'node_modules', ...name.split('/'));
    const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (installed.version !== version || installed.license !== 'MIT') {
      throw new Error(`${name} registry metadata differs`);
    }
    for (const required of ['LICENSE', 'README.md', 'dist/index.js', 'dist/index.d.ts']) {
      await stat(join(packageRoot, required));
    }
    if (
      Object.values(installed.dependencies ?? {}).some(value =>
        String(value).startsWith('workspace:'),
      )
    ) {
      throw new Error(`${name} registry manifest contains a workspace dependency`);
    }
    await import(pathToFileURL(join(packageRoot, 'dist', 'index.js')).href);
  }

  await writeFile(
    join(temporaryDirectory, 'vite.config.mjs'),
    `import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [aelion()] });
`,
  );
  await writeFile(
    join(temporaryDirectory, 'index.html'),
    '<!doctype html><script type="module" src="/main.js"></script>\n',
  );
  await writeFile(
    join(temporaryDirectory, 'main.js'),
    `import { createProject } from '@aelion/sdk';
globalThis.__aelionRegistrySmoke = createProject().build().schemaVersion;
`,
  );
  const viteExecutable = join(temporaryDirectory, 'node_modules', 'vite', 'bin', 'vite.js');
  await run(process.execPath, [viteExecutable, 'build']);
  const emitted = (await walk(join(temporaryDirectory, 'dist'))).map(path =>
    path.slice(dirname(join(temporaryDirectory, 'dist')).length),
  );
  for (const marker of [
    'aelion-audio-pcm-message-player.worklet.js',
    'aelion-audio-pcm-player.worklet.js',
    'aelion-export-mux-export-worker.js',
    'aelion-renderer-worker-webgl2-worker.js',
  ]) {
    if (!emitted.some(path => path.includes(marker))) {
      throw new Error(`Registry Vite build did not emit ${marker}`);
    }
  }
  process.stdout.write(
    `Registry release smoke passed for ${PHASE_1_EXPECTED_PUBLIC_PACKAGES.length.toString()} packages at ${version}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
