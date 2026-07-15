import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
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
    if (entry.isDirectory()) await collectMarkdownFiles(path, files);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

function localTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.split(/\s+["']/u, 1)[0] ?? target;
  if (/^(?:data:|https?:|mailto:|#)/u.test(target)) return null;
  const [path] = target.split('#', 1);
  return path === undefined || path.length === 0 ? null : decodeURIComponent(path);
}

const failures = [];

for (const file of await collectMarkdownFiles()) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = localTarget(match[1]);
    if (target === null) continue;
    const path = resolve(dirname(file), target);
    try {
      await stat(path);
    } catch {
      failures.push(`${file.slice(root.length + 1)} -> ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local Markdown links:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('All local Markdown links resolve.');
}
