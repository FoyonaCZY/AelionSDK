import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = resolve(root, 'apps/docs/src/content/docs');
const chineseRoot = resolve(docsRoot, 'zh');

async function collect(directory, skipped = new Set(), files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, skipped, files);
    else if (entry.isFile() && /\.mdx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}

function relativeDocs(files, base) {
  return new Set(files.map(path => relative(base, path).replaceAll('\\', '/')));
}

function difference(left, right) {
  return [...left].filter(value => !right.has(value)).sort();
}

const englishFiles = await collect(docsRoot, new Set(['api', 'zh']));
const chineseFiles = await collect(chineseRoot);
const english = relativeDocs(englishFiles, docsRoot);
const chinese = relativeDocs(chineseFiles, chineseRoot);
const missingEnglish = difference(chinese, english);
const missingChinese = difference(english, chinese);

if (missingEnglish.length > 0 || missingChinese.length > 0) {
  throw new Error(
    [
      'English and Chinese narrative documentation routes must have one-to-one parity.',
      missingEnglish.length > 0 ? `Missing English: ${missingEnglish.join(', ')}` : '',
      missingChinese.length > 0 ? `Missing Chinese: ${missingChinese.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

const config = await readFile(resolve(root, 'apps/docs/astro.config.mjs'), 'utf8');
for (const file of [...english].sort()) {
  const extension = extname(file);
  const route = file.slice(0, -extension.length);
  const slug = route === 'index' ? '' : route.replace(/\/index$/u, '');
  if (!config.includes(`{ slug: '${slug}' }`)) {
    throw new Error(`The shared localized sidebar is missing narrative route: ${slug || '/'}`);
  }
}

for (const file of [...englishFiles, ...chineseFiles]) {
  const source = await readFile(file, 'utf8');
  if (source.includes('https://github.com/FoyonaCZY/AelionSDK/zh/')) {
    throw new Error(`${file} contains a locale segment inside a GitHub repository URL.`);
  }
}

for (const file of englishFiles) {
  if (file.endsWith(`${join('docs', 'index.mdx')}`)) continue;
  const source = await readFile(file, 'utf8');
  if (source.includes('/AelionSDK/zh/')) {
    throw new Error(`${file} links into the Chinese locale instead of its English peer.`);
  }
}

const englishReadme = await readFile(resolve(root, 'README.md'), 'utf8');
const chineseReadme = await readFile(resolve(root, 'README.zh-CN.md'), 'utf8');
if (!englishReadme.includes('[简体中文](README.zh-CN.md)')) {
  throw new Error('README.md must provide a prominent Simplified Chinese README switch.');
}
if (!chineseReadme.includes('[English](README.md)')) {
  throw new Error('README.zh-CN.md must provide a prominent English README switch.');
}

console.log(
  `Documentation locale parity passed: ${english.size} English and ${chinese.size} Chinese narrative routes.`,
);
