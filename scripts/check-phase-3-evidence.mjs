#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePerformanceEvidence, validateRecoveryEvidence } from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function validate(path, validator) {
  const absolutePath = resolve(root, path);
  const report = JSON.parse(await readFile(absolutePath, 'utf8'));
  const result = validator(report);
  if (!result.passed) {
    throw new Error(`${path} failed strict validation:\n- ${result.reasons.join('\n- ')}`);
  }
  console.log(`PASS ${path}`);
}

await validate('reports/baseline/performance-1080p30-chromium.json', validatePerformanceEvidence);
await validate('reports/baseline/recovery-chromium.json', validateRecoveryEvidence);
