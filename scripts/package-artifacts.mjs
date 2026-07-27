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
const packageManifestPath = resolve(packageDirectory, 'package.json');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanStagedArtifacts(marker) {
  if (typeof marker.originalPackageJson === 'string') {
    await writeFile(packageManifestPath, marker.originalPackageJson);
  }
  for (const file of marker.generated ?? []) {
    if (file === 'LICENSE' || file === 'README.md') {
      await rm(resolve(packageDirectory, file), { force: true });
    }
  }
  await rm(markerPath, { force: true });
}

async function publishedWorkspaceRange(name, range) {
  if (!name.startsWith('@aelion/')) {
    throw new Error(`Unsupported workspace dependency outside @aelion: ${name}`);
  }
  const dependencyDirectory = resolve(packagesRoot, name.slice('@aelion/'.length));
  const dependencyManifest = JSON.parse(
    await readFile(resolve(dependencyDirectory, 'package.json'), 'utf8'),
  );
  if (dependencyManifest.name !== name || typeof dependencyManifest.version !== 'string') {
    throw new Error(`Workspace dependency metadata differs for ${name}`);
  }
  const selector = range.slice('workspace:'.length);
  if (selector === '*') return dependencyManifest.version;
  if (selector === '^') return `^${dependencyManifest.version}`;
  if (selector === '~') return `~${dependencyManifest.version}`;
  return selector;
}

if (mode === 'stage') {
  if (await exists(markerPath)) {
    await cleanStagedArtifacts(JSON.parse(await readFile(markerPath, 'utf8')));
  }
  const originalPackageJson = await readFile(packageManifestPath, 'utf8');
  const manifest = JSON.parse(originalPackageJson);
  const generated = [];
  if (!(await exists(licensePath))) {
    generated.push('LICENSE');
  }
  if (!(await exists(readmePath))) {
    generated.push('README.md');
  }
  const marker = { schemaVersion: '2.0.0', generated, originalPackageJson };
  await writeFile(markerPath, `${JSON.stringify(marker)}\n`);

  try {
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (manifest[section] === undefined) continue;
      for (const [name, range] of Object.entries(manifest[section])) {
        if (typeof range === 'string' && range.startsWith('workspace:')) {
          manifest[section][name] = await publishedWorkspaceRange(name, range);
        }
      }
    }
    await writeFile(packageManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    if (generated.includes('LICENSE')) {
      await writeFile(licensePath, await readFile(resolve(root, 'LICENSE'), 'utf8'));
    }
    if (generated.includes('README.md')) {
      const description =
        manifest.description ?? 'A package in the AelionSDK browser editing stack.';
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
  } catch (error) {
    await cleanStagedArtifacts(marker);
    throw error;
  }
} else if (await exists(markerPath)) {
  await cleanStagedArtifacts(JSON.parse(await readFile(markerPath, 'utf8')));
}
