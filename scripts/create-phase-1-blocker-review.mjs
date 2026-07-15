#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PHASE_1_BLOCKER_REVIEW_CHECKS,
  WORKSPACE_IDENTITY_POLICY,
  buildBlockerReviewGateRunBinding,
  collectBlockerReviewArtifacts,
  sha256,
  sourceIdentity,
} from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(root, 'reports', 'baseline', 'phase-1-blocker-review.json');

function usage() {
  return `Usage: node scripts/create-phase-1-blocker-review.mjs [options]

Options:
  --output <file>  Template output path.
  --results <file> Completed serial gate result file to bind (required).
  --help           Show this help.

This command only creates a source/run/artifact-bound not-approved template. Approval is a
separate human audit action: reviewers must resolve every blocker, set all
checks true, provide reviewedAt/reviewers, and set decision to approved without
changing any binding.
`;
}

function parseArguments(argv) {
  let output = defaultOutput;
  let results = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (argument === '--output') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--output requires a value');
      output = resolve(root, value);
      index += 1;
      continue;
    }
    if (argument === '--results') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--results requires a value');
      results = resolve(root, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
  }
  if (results === null) throw new Error(`--results is required\n\n${usage()}`);
  return { output, results };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid.toString()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

const { output, results } = parseArguments(process.argv.slice(2));
const identity = await sourceIdentity(root);
const resultsBytes = await readFile(results);
const runDocument = JSON.parse(resultsBytes.toString('utf8'));
const gateRun = buildBlockerReviewGateRunBinding(
  runDocument,
  sha256(resultsBytes),
  await collectBlockerReviewArtifacts(root),
);
if (!gateRun.passed) {
  throw new Error(`Cannot create blocker review: ${gateRun.reasons.join('; ')}`);
}
if (runDocument.sourceIdentityAfter?.manifestSha256 !== identity.manifestSha256) {
  throw new Error('Cannot create blocker review: gate source identity differs from workspace');
}
const template = {
  schemaVersion: '3.0.0',
  evidenceKind: 'aelion-phase-1-blocker-review',
  generatedAt: new Date().toISOString(),
  decision: 'not-approved',
  reviewedAt: null,
  reviewers: [],
  sourceIdentity: {
    policyVersion: WORKSPACE_IDENTITY_POLICY.version,
    manifestSha256: identity.manifestSha256,
    vcsCommit: identity.vcs.commit,
  },
  gateRun: gateRun.binding,
  checks: Object.fromEntries(PHASE_1_BLOCKER_REVIEW_CHECKS.map(name => [name, false])),
  blockers: [
    {
      id: 'FINAL-GATES-NOT-REVIEWED',
      severity: 'release-blocker',
      status: 'open',
      summary: 'The bound final serial Phase 1 gate run has not completed independent review.',
      evidence: [],
    },
  ],
  notes: [
    'This file is intentionally not approved.',
    'Approval must follow a completed independent blocker audit and remain bound to this exact source, gate result and artifact set.',
  ],
};
await writeJsonAtomic(output, template);
process.stdout.write(
  `Wrote ${relative(root, output)} (not-approved, ${identity.manifestSha256})\n`,
);
