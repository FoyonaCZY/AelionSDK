#!/usr/bin/env node

/**
 * Validate one identity-bound Phase 1 runner record and its freshly generated
 * release artifacts. This script never runs project gates.
 *
 * A report is intentionally written for failed/incomplete evidence so CI can
 * retain diagnostics, but the process exits non-zero unless every command,
 * artifact, source-identity and blocker-review check passes.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  PHASE_1_ARTIFACT_CLOCK_TOLERANCE_MS,
  PHASE_1_EVIDENCE_REFRESH_COMMANDS,
  PHASE_1_EXPECTED_BROWSER_TESTS,
  PHASE_1_REQUIRED_GATE_COMMANDS,
  buildBlockerReviewGateRunBinding,
  collectBlockerReviewArtifacts,
  collectPhase1RunArtifacts,
  isSha256,
  sha256,
  sourceIdentity,
  stableJson,
  validateBlockerReview,
  validateGateRunDocument,
  validatePhase1PostflightAgainstArtifacts,
} from './phase-1-evidence-lib.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = join(root, 'reports', 'baseline', 'phase-1-final-gates.json');
const defaultBlockerReview = join(root, 'reports', 'baseline', 'phase-1-blocker-review.json');

function usage() {
  return `Usage: node scripts/capture-phase-1-final-gates.mjs --results <file> [options]

Options:
  --results <file>                    Required identity-bound runner record.
  --output <file>                     Aggregate report path.
  --blocker-review <file>             Machine-readable blocker review.
  --expected-source-identity <sha256> Require this workspace manifest hash.
  --help                              Show this help.

The standard report path is never written unless --results is explicitly supplied.
`;
}

function parseArguments(argv) {
  const options = {
    results: null,
    output: defaultOutput,
    blockerReview: defaultBlockerReview,
    expectedSourceIdentity: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (
      argument === '--results' ||
      argument === '--output' ||
      argument === '--blocker-review' ||
      argument === '--expected-source-identity'
    ) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--results') options.results = resolve(root, value);
      else if (argument === '--output') options.output = resolve(root, value);
      else if (argument === '--blocker-review') options.blockerReview = resolve(root, value);
      else options.expectedSourceIdentity = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
  }
  if (options.results === null) {
    throw new Error(`--results is required; refusing to overwrite final evidence\n\n${usage()}`);
  }
  if (options.expectedSourceIdentity !== null && !isSha256(options.expectedSourceIdentity)) {
    throw new Error('--expected-source-identity must be a lowercase SHA-256 digest');
  }
  return options;
}

function isoMilliseconds(value, field, command) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${command}: ${field} must be an ISO timestamp`);
  }
  return Date.parse(value);
}

function normalizeRecord(record, source) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${source}: each command result must be an object`);
  }
  const command = record.command;
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error(`${source}: command must be a non-empty string`);
  }
  const startedMs = isoMilliseconds(record.startedAt, 'startedAt', command);
  const endedMs = isoMilliseconds(record.endedAt, 'endedAt', command);
  if (endedMs < startedMs) throw new Error(`${command}: endedAt precedes startedAt`);
  if (!Number.isInteger(record.exitCode))
    throw new Error(`${command}: exitCode must be an integer`);
  if (!Object.hasOwn(record, 'summary')) {
    throw new Error(`${command}: summary is required (it may be null)`);
  }
  return {
    command,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startedMs,
    exitCode: record.exitCode,
    ...(record.signal === undefined ? {} : { signal: record.signal }),
    summary: record.summary,
  };
}

async function commandOutput(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd: root });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function environment() {
  const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const productVersion =
    process.platform === 'darwin' ? await commandOutput('sw_vers', ['-productVersion']) : null;
  return {
    node: process.version,
    pnpm: await commandOutput('corepack', ['pnpm', '--version']),
    expectedPackageManager: packageManifest.packageManager ?? null,
    os: {
      platform: process.platform,
      type: os.type(),
      release: os.release(),
      version: os.version(),
      productVersion,
      architecture: process.arch,
    },
  };
}

async function artifact(path, inspect) {
  const absolutePath = join(root, path);
  try {
    const [bytes, details] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    let inspected = {};
    if (inspect !== undefined) inspected = await inspect(bytes);
    return {
      status: 'present',
      file: path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      mtime: details.mtime.toISOString(),
      mtimeMs: details.mtimeMs,
      ...inspected,
    };
  } catch (error) {
    return {
      status: 'missing-or-invalid',
      file: path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectApiSnapshot(expectedVersion) {
  const apiSnapshot = await artifact('packages/sdk/api-snapshot.md', async bytes => {
    const source = bytes.toString('utf8');
    const match = source.match(/```json\n([\s\S]+?)\n```/u);
    if (match === null) throw new Error('missing JSON snapshot block');
    const snapshot = JSON.parse(match[1]);
    return {
      package: snapshot.package,
      version: snapshot.version,
      declarationFileCount: Object.keys(snapshot.files ?? {}).length,
      exportedSymbolCount: snapshot.exports?.length ?? 0,
      contractSha256: sha256(stableJson(snapshot)),
    };
  });
  return {
    ...apiSnapshot,
    validation: {
      passed:
        apiSnapshot.status === 'present' &&
        apiSnapshot.package === '@aelion/sdk' &&
        apiSnapshot.version === expectedVersion &&
        isSha256(apiSnapshot.contractSha256),
    },
  };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid.toString()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

const options = parseArguments(process.argv.slice(2));
const currentSourceIdentity = await sourceIdentity(root);
const expectedIdentity = options.expectedSourceIdentity ?? currentSourceIdentity.manifestSha256;
if (currentSourceIdentity.manifestSha256 !== expectedIdentity) {
  throw new Error(
    `Current source identity ${currentSourceIdentity.manifestSha256} differs from required ${expectedIdentity}`,
  );
}

const runDocumentBytes = await readFile(options.results);
const runDocument = JSON.parse(runDocumentBytes.toString('utf8'));
const runValidation = validateGateRunDocument(runDocument, expectedIdentity);
const gateRunBinding = buildBlockerReviewGateRunBinding(
  runDocument,
  sha256(runDocumentBytes),
  await collectBlockerReviewArtifacts(root),
);
const commands = (Array.isArray(runDocument.commands) ? runDocument.commands : []).map(
  (record, index) => normalizeRecord(record, `${options.results}[${index.toString()}]`),
);
const commandsByName = new Map(commands.map(record => [record.command, record]));
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const runArtifacts = await collectPhase1RunArtifacts(root);
const currentPostflight = validatePhase1PostflightAgainstArtifacts(runDocument, runArtifacts);
const artifacts = {
  apiSnapshot: await collectApiSnapshot(rootManifest.version),
  runner: currentPostflight.rebuilt.artifacts,
};
const checks = currentPostflight.rebuilt.checks;

let blockerReviewDocument;
let blockerReviewReadError = null;
try {
  blockerReviewDocument = JSON.parse(await readFile(options.blockerReview, 'utf8'));
} catch (error) {
  blockerReviewReadError = error instanceof Error ? error.message : String(error);
  blockerReviewDocument = null;
}
const blockerReview =
  blockerReviewReadError === null
    ? validateBlockerReview(blockerReviewDocument, currentSourceIdentity, {
        requireApproved: true,
        gateRun: gateRunBinding.binding,
      })
    : {
        passed: false,
        reasons: [`blocker review could not be read: ${blockerReviewReadError}`],
        details: null,
      };

const missingRequiredCommands = PHASE_1_REQUIRED_GATE_COMMANDS.filter(
  command => !commandsByName.has(command),
);
const failedRequiredCommands = PHASE_1_REQUIRED_GATE_COMMANDS.filter(
  command => commandsByName.has(command) && commandsByName.get(command).exitCode !== 0,
);
const missingEvidenceRefreshCommands = PHASE_1_EVIDENCE_REFRESH_COMMANDS.filter(
  command => !commandsByName.has(command),
);
const failedEvidenceRefreshCommands = PHASE_1_EVIDENCE_REFRESH_COMMANDS.filter(
  command => commandsByName.has(command) && commandsByName.get(command).exitCode !== 0,
);
const failedArtifactChecks = checks.filter(check => !check.passed).map(check => check.id);
const complete =
  runValidation.passed &&
  currentPostflight.passed &&
  gateRunBinding.passed &&
  missingRequiredCommands.length === 0 &&
  missingEvidenceRefreshCommands.length === 0;
const passed =
  complete &&
  failedRequiredCommands.length === 0 &&
  failedEvidenceRefreshCommands.length === 0 &&
  failedArtifactChecks.length === 0 &&
  artifacts.apiSnapshot.validation.passed &&
  blockerReview.passed;

const report = {
  schemaVersion: '3.0.0',
  evidenceKind: 'aelion-phase-1-final-gates',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/capture-phase-1-final-gates.mjs',
  environment: await environment(),
  sourceIdentity: currentSourceIdentity,
  sourceIdentityBinding: {
    expectedManifestSha256: expectedIdentity,
    runnerPreManifestSha256: runDocument.sourceIdentityBefore?.manifestSha256 ?? null,
    runnerPostManifestSha256: runDocument.sourceIdentityAfter?.manifestSha256 ?? null,
    runnerCertifiedEqual: runDocument.sourceIdentityMatches === true,
    validation: runValidation,
    gateRunBinding,
  },
  gatePolicy: {
    requiredCommands: PHASE_1_REQUIRED_GATE_COMMANDS,
    evidenceRefreshCommands: PHASE_1_EVIDENCE_REFRESH_COMMANDS,
    recordContract: ['command', 'startedAt', 'endedAt', 'exitCode', 'summary'],
    serialOrderRequired: true,
    artifactClockToleranceMs: PHASE_1_ARTIFACT_CLOCK_TOLERANCE_MS,
    expectedBrowserTests: PHASE_1_EXPECTED_BROWSER_TESTS,
    blockerReviewRequired: true,
  },
  commands,
  artifacts,
  artifactChecks: checks,
  blockerReview: {
    file: relative(root, options.blockerReview),
    ...blockerReview,
    ...(blockerReviewReadError === null
      ? { sha256: sha256(await readFile(options.blockerReview)) }
      : {}),
  },
  result: {
    status: passed ? 'passed' : complete ? 'failed' : 'incomplete',
    complete,
    passed,
    recordedCommandCount: commands.length,
    requiredGateCount: PHASE_1_REQUIRED_GATE_COMMANDS.length,
    evidenceRefreshCount: PHASE_1_EVIDENCE_REFRESH_COMMANDS.length,
    sourceIdentityFailures: runValidation.reasons,
    gateRunBindingFailures: gateRunBinding.reasons,
    currentPostflightFailures: currentPostflight.reasons,
    missingRequiredCommands,
    failedRequiredCommands,
    missingEvidenceRefreshCommands,
    failedEvidenceRefreshCommands,
    failedArtifactChecks,
    blockerReviewPassed: blockerReview.passed,
    blockerReviewFailures: blockerReview.reasons,
  },
};

await writeJsonAtomic(options.output, report);
process.stdout.write(`Wrote ${relative(root, options.output)} (${report.result.status})\n`);
if (!passed) process.exitCode = 1;
