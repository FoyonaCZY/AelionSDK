import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const distDirectory = resolve(root, 'apps/docs/dist');
const siteBase = '/AelionSDK/';

const builtFiles = new Set();

async function collectBuiltFiles(directory = distDirectory, htmlFiles = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectBuiltFiles(path, htmlFiles);
    } else if (entry.isFile()) {
      builtFiles.add(relative(distDirectory, path));
      if (entry.name.endsWith('.html')) htmlFiles.push(path);
    }
  }
  return htmlFiles;
}

function decodeHref(rawHref) {
  return rawHref.replaceAll('&amp;', '&').trim();
}

function resolveHref(sourceFile, rawHref) {
  const href = decodeHref(rawHref);
  if (href === '' || href.startsWith('#')) return sourceFile;
  if (/^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith('//')) return null;

  const [rawPath = ''] = href.split(/[?#]/u, 1);
  if (rawPath === '') return sourceFile;

  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }

  if (path === siteBase.slice(0, -1)) return distDirectory;
  if (path.startsWith(siteBase)) return resolve(distDirectory, path.slice(siteBase.length));
  if (path.startsWith('/')) return undefined;
  return resolve(dirname(sourceFile), path);
}

function targetExists(target) {
  const targetRelativePath = relative(distDirectory, target);
  if (targetRelativePath.startsWith('..') || targetRelativePath.startsWith('/')) return false;
  return (
    builtFiles.has(targetRelativePath) || builtFiles.has(join(targetRelativePath, 'index.html'))
  );
}

const failures = new Set();
const htmlFiles = await collectBuiltFiles();

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    const href = match[1] ?? match[2] ?? '';
    const target = resolveHref(file, href);
    if (target === null) continue;
    if (target === undefined || !targetExists(target)) {
      failures.add(`${relative(distDirectory, file)} -> ${href}`);
    }
  }
}

if (failures.size > 0) {
  console.error(`Broken links in built documentation:\n${[...failures].join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('All links in the built documentation resolve.');
}
