import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(packageDirectory, 'api-snapshot.md');
const entrypoint = 'dist/index.d.ts';
const update = process.argv.includes('--update');

function imports(source) {
  return [...source.matchAll(/(?:from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/gu)].map(
    match => match[1],
  );
}

function exportAll(source) {
  return [...source.matchAll(/export\s+\*\s+from\s+['"](\.\.?\/[^'"]+)['"]/gu)].map(
    match => match[1],
  );
}

function publicExports(source) {
  const names = [];
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|class|function|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gu,
  )) {
    names.push(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/gu)) {
    for (const specifier of match[1].split(',')) {
      const name = specifier
        .trim()
        .split(/\s+as\s+/u)
        .at(-1);
      if (name !== undefined && name !== '') names.push(name);
    }
  }
  return names;
}

async function resolveDeclaration(importer, specifier) {
  const candidate = resolve(dirname(importer), specifier);
  const paths = candidate.endsWith('.js')
    ? [`${candidate.slice(0, -3)}.d.ts`]
    : [`${candidate}.d.ts`, join(candidate, 'index.d.ts')];
  for (const path of paths) {
    try {
      await readFile(path, 'utf8');
      return path;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Public declaration ${specifier} imported by ${importer} was not built`);
}

async function collect(path, files, exports, publicModules, isPublicModule) {
  let source;
  if (files.has(path)) source = await readFile(path, 'utf8');
  else {
    source = await readFile(path, 'utf8');
    files.set(path, createHash('sha256').update(source).digest('hex'));
  }
  if (isPublicModule && !publicModules.has(path)) {
    publicModules.add(path);
    for (const name of publicExports(source)) exports.add(name);
  }
  for (const specifier of imports(source)) {
    const imported = await resolveDeclaration(path, specifier);
    const isPublicExport = isPublicModule && exportAll(source).includes(specifier);
    if (!files.has(imported) || (isPublicExport && !publicModules.has(imported))) {
      await collect(imported, files, exports, publicModules, isPublicExport);
    }
  }
}

function snapshotJson(markdown) {
  const match = markdown.match(/```json\n([\s\S]+?)\n```/u);
  if (match === null) throw new Error('api-snapshot.md must contain one JSON code block');
  return JSON.parse(match[1]);
}

const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
const files = new Map();
const exports = new Set();
await collect(join(packageDirectory, entrypoint), files, exports, new Set(), true);
const actual = {
  schemaVersion: '1.0.0',
  package: manifest.name,
  version: manifest.version,
  entrypoint,
  files: Object.fromEntries(
    [...files]
      .map(([path, hash]) => [relative(packageDirectory, path), hash])
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
  exports: [...exports].sort(),
};

if (update) {
  const markdown = await readFile(snapshotPath, 'utf8');
  const next = markdown.replace(
    /```json\n[\s\S]+?\n```/u,
    `\`\`\`json\n${JSON.stringify(actual, null, 2)}\n\`\`\``,
  );
  await writeFile(snapshotPath, next);
} else {
  const expected = snapshotJson(await readFile(snapshotPath, 'utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'Public API snapshot changed. Review semver/CHANGELOG, then run `corepack pnpm --filter @aelion/sdk api:snapshot:update`.',
    );
  }
}
