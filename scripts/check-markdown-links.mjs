import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';

const root = process.cwd();
const docsContentDirectory = resolve(root, 'apps/docs/src/content/docs');
const docsSiteBase = '/AelionSDK/';
const generatedDirectories = new Set([resolve(root, 'apps/docs/src/content/docs/api')]);
const skippedDirectories = new Set([
  '.git',
  '.pnpm-store',
  '.vite',
  '.vitest',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'playwright-report',
  'test-results',
]);

async function collectMarkdownFiles(directory = root, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && generatedDirectories.has(path)) continue;
    if (entry.isDirectory()) await collectMarkdownFiles(path, files);
    else if (entry.isFile() && /\.mdx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}

function localTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.split(/\s+["']/u, 1)[0] ?? target;
  if (/^(?:data:|https?:|mailto:|#)/u.test(target)) return null;
  const [path] = target.split(/[?#]/u, 1);
  return path === undefined || path.length === 0 ? null : decodeURIComponent(path);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function localTargetExists(file, target) {
  if (
    file.startsWith(`${docsContentDirectory}/`) &&
    (target === docsSiteBase.slice(0, -1) || target.startsWith(docsSiteBase))
  ) {
    const route =
      target === docsSiteBase.slice(0, -1)
        ? ''
        : target.slice(docsSiteBase.length).replace(/\/+$/u, '');
    if (route.startsWith('api/')) return true;

    const routePath = resolve(docsContentDirectory, route);
    const routeCandidates = [
      `${routePath}.md`,
      `${routePath}.mdx`,
      resolve(routePath, 'index.md'),
      resolve(routePath, 'index.mdx'),
    ];
    for (const candidate of routeCandidates) {
      if (await exists(candidate)) return true;
    }
    return false;
  }

  const directPath = resolve(dirname(file), target);
  if (await exists(directPath)) return true;

  if (extname(target) !== '') return false;

  const routeBase = basename(file).startsWith('index.')
    ? dirname(file)
    : file.slice(0, -extname(file).length);
  const routePath = resolve(routeBase, target);
  const candidates = [
    `${routePath}.md`,
    `${routePath}.mdx`,
    resolve(routePath, 'index.md'),
    resolve(routePath, 'index.mdx'),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) return true;
  }
  return false;
}

const failures = [];

for (const file of await collectMarkdownFiles()) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/(!?)\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = localTarget(match[2]);
    if (target === null) continue;
    if (file.startsWith(`${docsContentDirectory}/`) && /\.mdx?$/u.test(target)) {
      failures.push(
        `${file.slice(root.length + 1)} -> ${match[2]} (use the generated route without .md/.mdx)`,
      );
      continue;
    }
    if (
      file.startsWith(`${docsContentDirectory}/`) &&
      match[1] !== '!' &&
      target !== docsSiteBase.slice(0, -1) &&
      !target.startsWith(docsSiteBase)
    ) {
      failures.push(
        `${file.slice(root.length + 1)} -> ${match[2]} (use an absolute ${docsSiteBase} route)`,
      );
      continue;
    }
    if (!(await localTargetExists(file, target))) {
      failures.push(`${file.slice(root.length + 1)} -> ${match[2]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local Markdown links:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('All local Markdown links resolve.');
}
