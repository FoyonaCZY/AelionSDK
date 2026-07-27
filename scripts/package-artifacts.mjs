import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'stage' && mode !== 'clean') {
  throw new Error('Usage: node scripts/package-artifacts.mjs <stage|clean>');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = resolve(process.cwd());
const packagesRoot = resolve(root, 'packages');
const relativePackageDirectory = relative(packagesRoot, packageDirectory);
if (
  relativePackageDirectory.length === 0 ||
  relativePackageDirectory.startsWith('..') ||
  isAbsolute(relativePackageDirectory)
) {
  throw new Error('Package artifacts may only be staged below packages/');
}

const markerPath = resolve(packageDirectory, '.aelion-generated-package-artifacts.json');
const licensePath = resolve(packageDirectory, 'LICENSE');
const readmePath = resolve(packageDirectory, 'README.md');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanStagedArtifacts(marker) {
  for (const file of marker.generated ?? []) {
    if (file === 'LICENSE' || file === 'README.md') {
      await rm(resolve(packageDirectory, file), { force: true });
    }
  }
  await rm(markerPath, { force: true });
}

if (mode === 'stage') {
  if (await exists(markerPath)) {
    await cleanStagedArtifacts(JSON.parse(await readFile(markerPath, 'utf8')));
  }
  const manifest = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8'));
  const generated = [];
  if (!(await exists(licensePath))) {
    generated.push('LICENSE');
  }
  if (!(await exists(readmePath))) {
    generated.push('README.md');
  }
  await writeFile(markerPath, `${JSON.stringify({ schemaVersion: '2.0.0', generated })}\n`);

  if (generated.includes('LICENSE')) {
    await writeFile(licensePath, await readFile(resolve(root, 'LICENSE'), 'utf8'));
  }
  if (generated.includes('README.md')) {
    const description = manifest.description ?? 'A package in the AelionSDK browser editing stack.';
    const prerelease = manifest.version.includes('-');
    const releaseNotice = prerelease
      ? `Version ${manifest.version} is a prerelease and its API may change before the first stable release.`
      : `Version ${manifest.version} follows the compatibility policy documented by AelionSDK.`;
    const installTarget = prerelease ? `${manifest.name}@next` : manifest.name;
    await writeFile(
      readmePath,
      `# ${manifest.name}\n\n${description}\n\nInstall with \`npm install ${installTarget}\`.\n\n${releaseNotice} This package is part of [AelionSDK](https://github.com/FoyonaCZY/AelionSDK); see the repository README for supported browsers, examples and deployment requirements.\n`,
    );
  }
} else if (await exists(markerPath)) {
  await cleanStagedArtifacts(JSON.parse(await readFile(markerPath, 'utf8')));
}
