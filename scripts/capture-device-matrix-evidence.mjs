#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capture = process.argv.includes('--capture');

const matrix = JSON.parse(
  await readFile(resolve(root, 'compatibility', 'device-matrix.json'), 'utf8'),
);
const sdkVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const outputDirectory = resolve(root, 'reports', 'baseline');

const validEmulated = new Set(['automated', 'pending-capture']);
const validPhysical = new Set(['pending-credentials']);

const problems = [];
if (matrix.schemaVersion === undefined)
  problems.push('device-matrix.json must declare schemaVersion');
if (matrix.sdkVersion !== sdkVersion) {
  problems.push(`device-matrix.json sdkVersion ${matrix.sdkVersion} does not match ${sdkVersion}`);
}
if (!Array.isArray(matrix.devices) || matrix.devices.length === 0) {
  problems.push('device-matrix.json must declare at least one device');
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${(stderr || stdout).slice(-1200)}`));
      else resolvePromise(stdout);
    });
  });
}

async function exists(path) {
  try {
    await access(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

const deviceEntries = [];
for (const device of matrix.devices ?? []) {
  const entry = { id: device.id, category: device.category, status: device.status };
  if (device.category === 'emulated') {
    if (!validEmulated.has(device.status)) {
      problems.push(`${device.id} has invalid emulated status ${device.status}`);
    }
    if (typeof device.captureCommand !== 'string' || device.captureCommand.length === 0) {
      problems.push(`${device.id} must declare a captureCommand`);
    }
    entry.evidencePresent = [];
    entry.missingEvidence = [];
    for (const evidence of device.evidence ?? []) {
      ((await exists(evidence)) ? entry.evidencePresent : entry.missingEvidence).push(evidence);
    }
    if (device.status === 'automated' && entry.missingEvidence.length > 0) {
      problems.push(
        `${device.id} is automated but missing evidence: ${entry.missingEvidence.join(', ')}`,
      );
    }
    if (device.status === 'pending-capture' && capture && entry.missingEvidence.length > 0) {
      try {
        const [command, ...args] = device.captureCommand.split(' ');
        await run(command, args);
        for (const evidence of entry.missingEvidence) {
          if (await exists(evidence)) entry.evidencePresent.push(evidence);
        }
        entry.missingEvidence = entry.missingEvidence.filter(
          evidence => !entry.evidencePresent.includes(evidence),
        );
        entry.captured = true;
      } catch (cause) {
        entry.captureError = cause instanceof Error ? cause.message : String(cause);
        problems.push(`${device.id} capture failed: ${entry.captureError}`);
      }
    }
  } else if (device.category === 'physical') {
    if (!validPhysical.has(device.status)) {
      problems.push(`${device.id} has invalid physical status ${device.status}`);
    }
    if (!Array.isArray(device.evidenceChecklist) || device.evidenceChecklist.length === 0) {
      problems.push(`${device.id} must declare an evidenceChecklist`);
    }
    entry.evidenceChecklist = device.evidenceChecklist;
  } else {
    problems.push(`${device.id} has unknown category ${device.category}`);
  }
  deviceEntries.push(entry);
}

if (problems.length > 0) {
  throw new Error(`Device matrix is invalid:\n- ${problems.join('\n- ')}`);
}

const summary = {
  emulated: deviceEntries.filter(entry => entry.category === 'emulated').length,
  physical: deviceEntries.filter(entry => entry.category === 'physical').length,
  automated: deviceEntries.filter(entry => entry.status === 'automated').length,
  pendingCapture: deviceEntries.filter(entry => entry.status === 'pending-capture').length,
  pendingCredentials: deviceEntries.filter(entry => entry.status === 'pending-credentials').length,
};

await mkdir(outputDirectory, { recursive: true });
const evidence = {
  evidenceVersion: '1.0.0',
  command: 'pnpm report:device-matrix',
  captured: capture,
  generatedAt: new Date().toISOString(),
  summary,
  devices: deviceEntries,
};
const evidencePath = resolve(outputDirectory, 'device-matrix-evidence.json');
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(
  `Device matrix ${matrix.schemaVersion} for ${sdkVersion}: ${summary.emulated} emulated (${summary.automated} automated, ${summary.pendingCapture} pending-capture), ${summary.physical} physical pending-credentials. ${capture ? 'Capture run.' : 'Dry run.'} -> ${evidencePath}\n`,
);
