import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = resolve(root, 'apps/docs/src/content/docs/api/@aelionsdk');
const baselinePath = resolve(root, 'apps/docs/api-doc-coverage-baseline.json');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path);
    }
  }
  return files;
}

function hasNarrative(source) {
  const definedMatch = /(?:^|\r?\n)Defined in:[^\r\n]*(?:\r?\n)/u.exec(source);
  if (definedMatch === null) return false;
  const afterDefinition = source.slice(definedMatch.index + definedMatch[0].length);
  const nextHeading = afterDefinition.search(/^## /mu);
  const narrative = nextHeading === -1 ? afterDefinition : afterDefinition.slice(0, nextHeading);
  return narrative.trim().length > 0;
}

const generatedPackages = (await readdir(apiRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const expectedPackages = Object.keys(baseline.packages).sort();

if (JSON.stringify(generatedPackages) !== JSON.stringify(expectedPackages)) {
  throw new Error(
    `Generated API packages differ from the coverage baseline.\nExpected: ${expectedPackages.join(', ')}\nReceived: ${generatedPackages.join(', ')}`,
  );
}

const failures = [];
let totalDeclarations = 0;
let totalUndocumented = 0;

for (const packageName of expectedPackages) {
  const files = (await markdownFiles(join(apiRoot, packageName))).filter(
    path => basename(path) !== 'overview.md',
  );
  if (files.length === 0) {
    failures.push(`${packageName}: no generated declaration pages`);
    continue;
  }

  const undocumented = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    if (!hasNarrative(source)) undocumented.push(path);
  }

  totalDeclarations += files.length;
  totalUndocumented += undocumented.length;
  const maximum = baseline.packages[packageName];
  if (undocumented.length > maximum) {
    failures.push(
      `${packageName}: ${undocumented.length.toString()} undocumented declarations exceeds baseline ${maximum.toString()}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`API documentation coverage regressed:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(
    `API documentation coverage passed: ${totalUndocumented.toString()} of ${totalDeclarations.toString()} declaration pages are at or below the per-package baselines.`,
  );
}
