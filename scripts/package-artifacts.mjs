import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'stage' && mode !== 'clean') {
  throw new Error('Usage: node scripts/package-artifacts.mjs <stage|clean>');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = resolve(process.cwd());
const packagesRoot = resolve(root, 'packages');
if (!packageDirectory.startsWith(`${packagesRoot}/`)) {
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

if (mode === 'stage') {
  const manifest = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8'));
  const generated = (await exists(markerPath))
    ? (JSON.parse(await readFile(markerPath, 'utf8')).generated ?? [])
    : [];
  if (!(await exists(licensePath))) {
    await writeFile(licensePath, await readFile(resolve(root, 'LICENSE'), 'utf8'));
    generated.push('LICENSE');
  }
  if (!(await exists(readmePath))) {
    const description = manifest.description ?? 'A package in the AelionSDK browser editing stack.';
    await writeFile(
      readmePath,
      `# ${manifest.name}\n\n${description}\n\nThis package is part of [AelionSDK](https://github.com/FoyonaCZY/AelionSDK). The ${manifest.version} release is an alpha and its API may change. See the repository README for supported browsers, examples and deployment requirements.\n`,
    );
    generated.push('README.md');
  }
  await writeFile(markerPath, `${JSON.stringify({ generated })}\n`);
} else if (await exists(markerPath)) {
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  for (const file of marker.generated ?? []) {
    if (file === 'LICENSE' || file === 'README.md') {
      await rm(resolve(packageDirectory, file), { force: true });
    }
  }
  await rm(markerPath, { force: true });
}
