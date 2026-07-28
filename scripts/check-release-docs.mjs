import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = manifest.version;
const packageRoot = resolve(root, 'packages');
const packageReadmes = [];

for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(packageRoot, entry.name);
  const packageManifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (packageManifest.private !== true && String(packageManifest.name).startsWith('@aelionsdk/')) {
    packageReadmes.push(join(directory, 'README.md'));
  }
}

const versionedFiles = [
  resolve(root, 'README.md'),
  resolve(root, 'README.zh-CN.md'),
  resolve(root, 'apps/docs/src/content/docs/project/status.md'),
  resolve(root, 'apps/docs/src/content/docs/zh/project/status.md'),
  resolve(root, 'apps/docs/src/content/docs/reference/packages.md'),
  resolve(root, 'apps/docs/src/content/docs/zh/reference/packages.md'),
  resolve(root, 'apps/docs/src/content/docs/start/installation.md'),
  resolve(root, 'apps/docs/src/content/docs/zh/start/installation.md'),
  resolve(root, 'packages/vite-plugin/README.md'),
  ...packageReadmes,
];
const sources = new Map();
for (const path of versionedFiles) {
  const source = await readFile(path, 'utf8');
  sources.set(path, source);
  if (!source.includes(version)) {
    throw new Error(`${path} does not mention the current workspace version ${version}`);
  }
}

const installSource = sources.get(
  resolve(root, 'apps/docs/src/content/docs/zh/start/installation.md'),
);
for (const expected of [
  `aelionsdk/${version}/`,
  `@aelionsdk/sdk@${version}`,
  `npm view @aelionsdk/sdk@${version}`,
]) {
  if (!installSource.includes(expected)) {
    throw new Error(`Installation documentation is missing current release example: ${expected}`);
  }
}

const viteReadme = sources.get(resolve(root, 'packages/vite-plugin/README.md'));
if (!viteReadme.includes(`sdk/${version}/`)) {
  throw new Error(`Vite plugin README CDN example is not pinned to ${version}`);
}

const review = JSON.parse(
  await readFile(resolve(root, 'reports/baseline/phase-1-blocker-review.json'), 'utf8'),
);
if (review.decision === 'approved') {
  const publishedStatus = [
    sources.get(resolve(root, 'README.md')),
    sources.get(resolve(root, 'apps/docs/src/content/docs/zh/project/status.md')),
    await readFile(resolve(root, 'docs/status.md'), 'utf8'),
  ].join('\n');
  for (const staleClaim of [
    'must remain `not-approved`',
    'must not be performed',
    '在签字前必须保持 `not-approved`',
    '不能因此声称 npm 1.0 已发布',
  ]) {
    if (publishedStatus.includes(staleClaim)) {
      throw new Error(`Approved release documentation still contains stale claim: ${staleClaim}`);
    }
  }
  if (!publishedStatus.includes('approved') || !publishedStatus.includes('provenance')) {
    throw new Error('Approved release documentation must state the review result and provenance.');
  }
}

console.log(
  `Release documentation passed for ${version}: ${packageReadmes.length.toString()} public package READMEs and published-status checks are synchronized.`,
);
