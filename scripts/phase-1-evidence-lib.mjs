import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PHASE_1_REQUIRED_GATE_COMMANDS = Object.freeze([
  'corepack pnpm run ci',
  'corepack pnpm test:browser',
  'corepack pnpm test:browser:firefox',
  'corepack pnpm test:golden',
  'corepack pnpm bench',
  'corepack pnpm test:pack',
  'corepack pnpm test:consumer',
  'corepack pnpm release:dry-run',
  'corepack pnpm format:check',
]);

export const PHASE_1_EVIDENCE_REFRESH_COMMANDS = Object.freeze([
  'corepack pnpm report:browser:chromium',
  'corepack pnpm report:browser:firefox',
  'corepack pnpm report:seek',
  'corepack pnpm report:performance',
  'corepack pnpm report:alpha',
]);

export const PHASE_1_EXPECTED_PUBLIC_PACKAGES = Object.freeze([
  '@aelion/audio',
  '@aelion/capability',
  '@aelion/core',
  '@aelion/export',
  '@aelion/material-compiler',
  '@aelion/material-sdk',
  '@aelion/media',
  '@aelion/project-schema',
  '@aelion/render-ir',
  '@aelion/renderer-worker',
  '@aelion/sdk',
  '@aelion/transaction',
  '@aelion/vite-plugin',
]);

export const PHASE_1_EXPECTED_RUNTIME_ASSETS = Object.freeze([
  'pcm-message-player-worklet',
  'pcm-player-worklet',
  'webgl2-worker',
]);

// This is an explicit release contract, not a minimum. Adding or removing a
// browser conformance test requires reviewing this count together with Phase 1.
export const PHASE_1_EXPECTED_BROWSER_TESTS = Object.freeze({
  chromium: 59,
  firefox: 54,
});

export const PHASE_1_ARTIFACT_CLOCK_TOLERANCE_MS = 5_000;

export const PHASE_1_BLOCKER_REVIEW_CHECKS = Object.freeze([
  'resourceBounds',
  'cancellationAndCleanup',
  'materialTransportIntegrity',
  'publicApiAndDistribution',
  'evidenceIntegrity',
]);

/** Generated artifacts validated by the runner before it may exit successfully. */
export const PHASE_1_RUN_ARTIFACTS = Object.freeze([
  Object.freeze({
    file: 'reports/baseline/browser-smoke-chromium.json',
    command: 'corepack pnpm report:browser:chromium',
  }),
  Object.freeze({
    file: 'reports/baseline/browser-smoke-firefox.json',
    command: 'corepack pnpm report:browser:firefox',
  }),
  Object.freeze({
    file: 'reports/baseline/media-seek-chromium.json',
    command: 'corepack pnpm report:seek',
  }),
  Object.freeze({
    file: 'reports/baseline/performance-1080p30-chromium.json',
    command: 'corepack pnpm report:performance',
  }),
  Object.freeze({
    file: 'reports/baseline/tarball-consumer.json',
    command: 'corepack pnpm test:consumer',
  }),
  Object.freeze({
    file: 'reports/baseline/alpha-60s.json',
    command: 'corepack pnpm report:alpha',
  }),
  Object.freeze({
    file: 'reports/baseline/alpha-60s.webm',
    command: 'corepack pnpm report:alpha',
  }),
]);

/**
 * Status projections that necessarily change after a gate run has produced its
 * exact counts and hashes. They are excluded from the pre/post source manifest,
 * then content-bound by the post-run blocker review above. No other document is
 * permitted to bypass source identity.
 */
export const PHASE_1_POST_GATE_DOCUMENTS = Object.freeze(['README.md', 'docs/status.md']);

/**
 * Exact files an independent review binds. The runner-produced prefix must
 * match its embedded postflight record; the status projections are authored
 * only after the run and therefore remain a separate freshness class.
 */
export const PHASE_1_BLOCKER_REVIEW_ARTIFACTS = Object.freeze([
  ...PHASE_1_RUN_ARTIFACTS,
  ...PHASE_1_POST_GATE_DOCUMENTS.map(file => Object.freeze({ file, freshness: 'post-run' })),
]);

export const WORKSPACE_IDENTITY_POLICY = Object.freeze({
  version: '3.1.0',
  algorithm: 'sha256(stable-json(files))',
  symbolicLinks: 'reject every non-excluded symbolic link',
  specialFiles: 'reject every non-excluded non-regular filesystem entry',
  exclusions: Object.freeze([
    'root reports/** and benchmarks/reports/** evidence outputs',
    'VCS/dependency/build/cache directories: .git, .pnpm-store, .vite, .vitest, coverage, dist, node_modules, playwright-report, test-results',
    'browser snapshot output directories named __screenshots__',
    'generated app Vite declarations: apps/*/vite.config.{js,d.ts,d.ts.map}',
    'OS/log/compiler transients: .DS_Store, *.log, *.tsbuildinfo',
    'post-gate status projections listed by PHASE_1_POST_GATE_DOCUMENTS; exact bytes/hash/mtime are blocker-review bound',
  ]),
});

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

export function excludedWorkspacePath(root, path) {
  const relativePath = normalizedPath(root, path);
  if (PHASE_1_POST_GATE_DOCUMENTS.includes(relativePath)) return true;
  const segments = relativePath.split('/');
  if (relativePath === 'reports' || relativePath.startsWith('reports/')) return true;
  if (relativePath === 'benchmarks/reports' || relativePath.startsWith('benchmarks/reports/')) {
    return true;
  }
  if (
    segments.some(segment =>
      [
        '.git',
        '.pnpm-store',
        '.vite',
        '.vitest',
        '__screenshots__',
        'coverage',
        'dist',
        'node_modules',
        'playwright-report',
        'test-results',
      ].includes(segment),
    )
  ) {
    return true;
  }
  const name = segments.at(-1) ?? '';
  if (name === '.DS_Store' || name.endsWith('.log') || name.endsWith('.tsbuildinfo')) return true;
  return /^apps\/[^/]+\/vite\.config\.(?:js|d\.ts|d\.ts\.map)$/u.test(relativePath);
}

async function workspaceFiles(root, directory = root, entries = []) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    if (excludedWorkspacePath(root, path)) continue;
    const details = await lstat(path);
    if (details.isDirectory()) await workspaceFiles(root, path, entries);
    else if (details.isFile()) {
      const bytes = await readFile(path);
      entries.push({
        path: normalizedPath(root, path),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    } else if (details.isSymbolicLink()) {
      throw new Error(
        `Source identity refuses non-excluded symbolic link: ${normalizedPath(root, path)}`,
      );
    } else {
      throw new Error(
        `Source identity refuses non-excluded special file: ${normalizedPath(root, path)}`,
      );
    }
  }
  return entries;
}

async function commandOutput(root, command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function sourceIdentity(root) {
  const files = await workspaceFiles(root);
  const commit = await commandOutput(root, 'git', ['rev-parse', '--verify', 'HEAD']);
  const tree =
    commit === null ? null : await commandOutput(root, 'git', ['rev-parse', 'HEAD^{tree}']);
  return {
    kind: 'workspace-input-manifest',
    policyVersion: WORKSPACE_IDENTITY_POLICY.version,
    algorithm: WORKSPACE_IDENTITY_POLICY.algorithm,
    symbolicLinks: WORKSPACE_IDENTITY_POLICY.symbolicLinks,
    specialFiles: WORKSPACE_IDENTITY_POLICY.specialFiles,
    exclusions: [...WORKSPACE_IDENTITY_POLICY.exclusions],
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + (file.bytes ?? 0), 0),
    manifestSha256: sha256(stableJson(files)),
    vcs: { commit, tree },
    files,
  };
}

export function sourceIdentitiesEqual(left, right) {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const policyExclusions = [...WORKSPACE_IDENTITY_POLICY.exclusions];
  return (
    left.kind === 'workspace-input-manifest' &&
    right.kind === left.kind &&
    left.policyVersion === WORKSPACE_IDENTITY_POLICY.version &&
    right.policyVersion === left.policyVersion &&
    left.algorithm === WORKSPACE_IDENTITY_POLICY.algorithm &&
    right.algorithm === left.algorithm &&
    left.symbolicLinks === WORKSPACE_IDENTITY_POLICY.symbolicLinks &&
    right.symbolicLinks === left.symbolicLinks &&
    left.specialFiles === WORKSPACE_IDENTITY_POLICY.specialFiles &&
    right.specialFiles === left.specialFiles &&
    stableJson(left.exclusions) === stableJson(policyExclusions) &&
    stableJson(right.exclusions) === stableJson(policyExclusions) &&
    left.manifestSha256 === right.manifestSha256 &&
    left.fileCount === right.fileCount &&
    left.totalBytes === right.totalBytes &&
    left.vcs?.commit === right.vcs?.commit &&
    left.vcs?.tree === right.vcs?.tree
  );
}

export function validateGateRunDocument(document, expectedManifestSha256) {
  const reasons = [];
  if (document?.schemaVersion !== '3.0.0') reasons.push('gate results schemaVersion must be 3.0.0');
  if (document?.generatedBy !== 'scripts/run-phase-1-final-gates.mjs') {
    reasons.push('gate results must be generated by the Phase 1 runner');
  }
  if (!validTimestamp(document?.startedAt) || !validTimestamp(document?.endedAt)) {
    reasons.push('gate results require valid startedAt and endedAt timestamps');
  } else if (Date.parse(document.endedAt) < Date.parse(document.startedAt)) {
    reasons.push('gate results endedAt precedes startedAt');
  }
  if (document?.sourceIdentityMatches !== true) {
    reasons.push('runner did not certify matching pre-run and post-run source identities');
  }
  if (!sourceIdentitiesEqual(document?.sourceIdentityBefore, document?.sourceIdentityAfter)) {
    reasons.push('pre-run and post-run source identities differ');
  }
  if (document?.sourceIdentityAfter?.manifestSha256 !== expectedManifestSha256) {
    reasons.push('gate results are not bound to the required source manifest');
  }
  const commands = Array.isArray(document?.commands) ? document.commands : [];
  const expectedCommands = [
    ...PHASE_1_REQUIRED_GATE_COMMANDS,
    ...PHASE_1_EVIDENCE_REFRESH_COMMANDS,
  ];
  if (commands.length !== expectedCommands.length) {
    reasons.push(
      `gate results must contain exactly ${expectedCommands.length.toString()} commands`,
    );
  }
  if (stableJson(commands.map(command => command?.command)) !== stableJson(expectedCommands)) {
    reasons.push('gate results commands or order differ from the reviewed policy');
  }
  for (const [index, command] of commands.entries()) {
    if (!validTimestamp(command?.startedAt) || !validTimestamp(command?.endedAt)) {
      reasons.push(`command ${index.toString()} has invalid timestamps`);
      continue;
    }
    const startedAt = Date.parse(command.startedAt);
    const endedAt = Date.parse(command.endedAt);
    if (endedAt < startedAt) reasons.push(`${command.command} ended before it started`);
    if (Number.isInteger(command?.exitCode) !== true) {
      reasons.push(`${command.command} exitCode must be an integer`);
    } else if (command.exitCode !== 0) {
      reasons.push(`${command.command} did not pass`);
    }
    if (!Object.hasOwn(command, 'summary')) reasons.push(`${command.command} summary is missing`);
    const previous = commands[index - 1];
    if (previous !== undefined && validTimestamp(previous.endedAt)) {
      if (startedAt < Date.parse(previous.endedAt)) {
        reasons.push(`${command.command} overlaps the preceding serial gate`);
      }
    }
  }
  const postflight = validatePhase1PostflightRecord(document?.postflight);
  if (!postflight.passed) {
    reasons.push(...postflight.reasons.map(reason => `postflight is invalid: ${reason}`));
  }
  const finalCommand = commands.at(-1);
  if (
    validTimestamp(document?.postflight?.generatedAt) &&
    validTimestamp(finalCommand?.endedAt) &&
    Date.parse(document.postflight.generatedAt) < Date.parse(finalCommand.endedAt)
  ) {
    reasons.push('postflight predates the final command completion');
  }
  if (
    validTimestamp(document?.postflight?.generatedAt) &&
    validTimestamp(document?.endedAt) &&
    Date.parse(document.postflight.generatedAt) > Date.parse(document.endedAt)
  ) {
    reasons.push('postflight was generated after the gate run ended');
  }
  return { passed: reasons.length === 0, reasons, commands };
}

export function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function timestampInGateWindow(
  value,
  gate,
  toleranceMs = PHASE_1_ARTIFACT_CLOCK_TOLERANCE_MS,
) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || gate === undefined) return false;
  const startedAt = Date.parse(gate.startedAt);
  const endedAt = Date.parse(gate.endedAt);
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(endedAt) &&
    timestamp >= startedAt - toleranceMs &&
    timestamp <= endedAt + toleranceMs
  );
}

function artifactBindingRecord(expected, actual) {
  return {
    file: expected.file,
    command: expected.command,
    bytes: actual?.bytes ?? null,
    sha256: actual?.sha256 ?? null,
    mtime: actual?.mtime ?? null,
  };
}

function postflightArtifactId(file) {
  return file
    .replace(/^reports\/baseline\//u, '')
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase();
}

function expectedPostflightCheckIds() {
  return [
    'all-commands-passed',
    ...PHASE_1_RUN_ARTIFACTS.flatMap(artifact => {
      const id = postflightArtifactId(artifact.file);
      return [
        `${id}-producer-passed`,
        `${id}-present`,
        `${id}-mtime-fresh`,
        ...(artifact.file.endsWith('.json') ? [`${id}-embedded-time-fresh`, `${id}-semantic`] : []),
      ];
    }),
    'alpha-media-declaration-matches',
  ];
}

/** Reads the seven runner-owned artifacts without throwing on missing/corrupt files. */
export async function collectPhase1RunArtifacts(root) {
  return Promise.all(
    PHASE_1_RUN_ARTIFACTS.map(async expected => {
      try {
        const path = join(root, expected.file);
        const [bytes, details] = await Promise.all([readFile(path), lstat(path)]);
        const artifact = {
          ...expected,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          mtime: details.mtime.toISOString(),
          mtimeMs: details.mtimeMs,
        };
        if (!expected.file.endsWith('.json')) return artifact;
        try {
          return { ...artifact, document: JSON.parse(bytes.toString('utf8')) };
        } catch (error) {
          return {
            ...artifact,
            error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      } catch (error) {
        return {
          ...expected,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

function postflightSemanticValidation(expected, artifact, expectedVersion) {
  if (artifact?.document === undefined) return null;
  if (expected.file === 'reports/baseline/browser-smoke-chromium.json') {
    return strictVitestSummary(artifact.document, PHASE_1_EXPECTED_BROWSER_TESTS.chromium);
  }
  if (expected.file === 'reports/baseline/browser-smoke-firefox.json') {
    return strictVitestSummary(artifact.document, PHASE_1_EXPECTED_BROWSER_TESTS.firefox);
  }
  if (expected.file === 'reports/baseline/media-seek-chromium.json') {
    return validateSeekEvidence(artifact.document);
  }
  if (expected.file === 'reports/baseline/performance-1080p30-chromium.json') {
    return validatePerformanceEvidence(artifact.document);
  }
  if (expected.file === 'reports/baseline/tarball-consumer.json') {
    return validateTarballConsumer(artifact.document, expectedVersion);
  }
  if (expected.file === 'reports/baseline/alpha-60s.json') {
    return validateAlphaEvidence(artifact.document);
  }
  return null;
}

function embeddedArtifactTimestamp(expected, artifact) {
  if (expected.file === 'reports/baseline/browser-smoke-chromium.json') {
    return artifact?.document?.startTime;
  }
  if (expected.file === 'reports/baseline/browser-smoke-firefox.json') {
    return artifact?.document?.startTime;
  }
  if (expected.file.endsWith('.json')) return artifact?.document?.generatedAt;
  return undefined;
}

/**
 * Builds the fail-closed, self-contained runner postflight. It intentionally
 * does not read blocker review state or the post-gate status documents.
 */
export function buildPhase1Postflight(commands, artifacts, expectedVersion, generatedAt) {
  const checks = [];
  const check = (id, passed, reasons = [], details = undefined) => {
    checks.push({
      id,
      passed: passed === true,
      ...(reasons.length === 0 ? {} : { reasons }),
      ...(details === undefined ? {} : { details }),
    });
  };
  const actualCommands = Array.isArray(commands) ? commands : [];
  const expectedCommands = [
    ...PHASE_1_REQUIRED_GATE_COMMANDS,
    ...PHASE_1_EVIDENCE_REFRESH_COMMANDS,
  ];
  check(
    'all-commands-passed',
    actualCommands.length === expectedCommands.length &&
      stableJson(actualCommands.map(command => command?.command)) ===
        stableJson(expectedCommands) &&
      actualCommands.every(command => command?.exitCode === 0),
    [],
    { expectedCount: expectedCommands.length, recordedCount: actualCommands.length },
  );

  const commandsByName = new Map();
  for (const command of actualCommands) {
    const values = commandsByName.get(command?.command) ?? [];
    values.push(command);
    commandsByName.set(command?.command, values);
  }
  const actualArtifacts = Array.isArray(artifacts) ? artifacts : [];
  const files = [];
  for (const [index, expected] of PHASE_1_RUN_ARTIFACTS.entries()) {
    const artifact = actualArtifacts[index];
    const id = postflightArtifactId(expected.file);
    files.push(artifactBindingRecord(expected, artifact));
    const gateMatches = commandsByName.get(expected.command) ?? [];
    const gate = gateMatches[0];
    check(
      `${id}-producer-passed`,
      gateMatches.length === 1 && gate?.exitCode === 0,
      gateMatches.length === 1 ? [] : [`expected exactly one ${expected.command} record`],
    );
    const present =
      artifact?.file === expected.file &&
      artifact?.command === expected.command &&
      Number.isSafeInteger(artifact?.bytes) &&
      artifact.bytes > 0 &&
      isSha256(artifact?.sha256) &&
      validTimestamp(artifact?.mtime) &&
      artifact?.error === undefined;
    check(
      `${id}-present`,
      present,
      present ? [] : [artifact?.error ?? 'artifact metadata is missing or invalid'],
    );
    check(
      `${id}-mtime-fresh`,
      present && timestampInGateWindow(artifact?.mtimeMs ?? artifact?.mtime, gate),
      [],
      { value: artifact?.mtime ?? null, command: expected.command },
    );
    if (expected.file.endsWith('.json')) {
      const embeddedTimestamp = embeddedArtifactTimestamp(expected, artifact);
      check(
        `${id}-embedded-time-fresh`,
        present && timestampInGateWindow(embeddedTimestamp, gate),
        [],
        { value: embeddedTimestamp ?? null, command: expected.command },
      );
      let validation;
      try {
        validation = postflightSemanticValidation(expected, artifact, expectedVersion);
      } catch (error) {
        validation = {
          passed: false,
          reasons: [error instanceof Error ? error.message : String(error)],
        };
      }
      check(
        `${id}-semantic`,
        present && validation?.passed === true,
        validation?.reasons ?? ['semantic validator was unavailable'],
        validation?.details,
      );
    }
  }

  const alphaReport = actualArtifacts.find(
    artifact => artifact?.file === 'reports/baseline/alpha-60s.json',
  );
  const alphaMedia = actualArtifacts.find(
    artifact => artifact?.file === 'reports/baseline/alpha-60s.webm',
  );
  check(
    'alpha-media-declaration-matches',
    alphaMedia?.sha256 === alphaReport?.document?.artifact?.sha256 &&
      alphaMedia?.bytes === alphaReport?.document?.artifact?.bytes &&
      alphaReport?.document?.artifact?.file === 'reports/baseline/alpha-60s.webm',
  );

  const failedChecks = checks.filter(value => !value.passed).map(value => value.id);
  return {
    schemaVersion: '1.0.0',
    generatedAt: generatedAt ?? new Date().toISOString(),
    expectedVersion,
    passed: failedChecks.length === 0,
    checks,
    failedChecks,
    artifacts: { files, setSha256: sha256(stableJson(files)) },
  };
}

export function validatePhase1PostflightRecord(postflight) {
  const reasons = [];
  if (postflight?.schemaVersion !== '1.0.0') reasons.push('schemaVersion must be 1.0.0');
  if (!validTimestamp(postflight?.generatedAt))
    reasons.push('generatedAt must be an ISO timestamp');
  if (!nonEmptyString(postflight?.expectedVersion)) reasons.push('expectedVersion is missing');
  const checks = Array.isArray(postflight?.checks) ? postflight.checks : [];
  if (!Array.isArray(postflight?.checks) || checks.length === 0) {
    reasons.push('checks must be a non-empty array');
  }
  const ids = checks.map(check => check?.id);
  if (ids.some(id => !nonEmptyString(id)) || new Set(ids).size !== ids.length) {
    reasons.push('check ids must be non-empty and unique');
  }
  if (checks.some(check => typeof check?.passed !== 'boolean')) {
    reasons.push('every check requires a boolean passed value');
  }
  if (stableJson(ids) !== stableJson(expectedPostflightCheckIds())) {
    reasons.push('checks or check order differ from the postflight policy');
  }
  const actualFailures = checks.filter(check => check?.passed !== true).map(check => check?.id);
  if (stableJson(postflight?.failedChecks) !== stableJson(actualFailures)) {
    reasons.push('failedChecks differs from check results');
  }
  if (postflight?.passed !== true || actualFailures.length !== 0) {
    reasons.push('postflight did not pass every check');
  }
  const files = Array.isArray(postflight?.artifacts?.files) ? postflight.artifacts.files : [];
  if (files.length !== PHASE_1_RUN_ARTIFACTS.length) {
    reasons.push(`artifact file count must equal ${PHASE_1_RUN_ARTIFACTS.length.toString()}`);
  }
  for (const [index, expected] of PHASE_1_RUN_ARTIFACTS.entries()) {
    const file = files[index];
    if (file?.file !== expected.file || file?.command !== expected.command) {
      reasons.push(`artifact ${index.toString()} differs from the postflight policy`);
    }
    if (!Number.isSafeInteger(file?.bytes) || file.bytes <= 0) {
      reasons.push(`${expected.file} bytes are invalid`);
    }
    if (!isSha256(file?.sha256)) reasons.push(`${expected.file} SHA-256 is invalid`);
    if (!validTimestamp(file?.mtime)) reasons.push(`${expected.file} mtime is invalid`);
  }
  if (
    !isSha256(postflight?.artifacts?.setSha256) ||
    postflight.artifacts.setSha256 !== sha256(stableJson(files))
  ) {
    reasons.push('artifact set SHA-256 differs from its file records');
  }
  return { passed: reasons.length === 0, reasons, details: postflight ?? null };
}

/** Re-runs postflight semantics/freshness against the current artifact bytes. */
export function validatePhase1PostflightAgainstArtifacts(runDocument, artifacts) {
  const expectedVersion = runDocument?.postflight?.expectedVersion;
  const rebuilt = buildPhase1Postflight(
    runDocument?.commands,
    artifacts,
    expectedVersion,
    runDocument?.postflight?.generatedAt,
  );
  const structural = validatePhase1PostflightRecord(runDocument?.postflight);
  const reasons = [...structural.reasons];
  if (stableJson(rebuilt) !== stableJson(runDocument?.postflight)) {
    reasons.push('stored postflight differs from validation of the current artifact bytes');
  }
  return { passed: reasons.length === 0, reasons, rebuilt };
}

export async function collectBlockerReviewArtifacts(root) {
  const runArtifacts = await collectPhase1RunArtifacts(root);
  const postGateArtifacts = await Promise.all(
    PHASE_1_BLOCKER_REVIEW_ARTIFACTS.slice(PHASE_1_RUN_ARTIFACTS.length).map(async expected => {
      try {
        const path = join(root, expected.file);
        const [bytes, details] = await Promise.all([readFile(path), lstat(path)]);
        return {
          ...expected,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          mtime: details.mtime.toISOString(),
          mtimeMs: details.mtimeMs,
        };
      } catch (error) {
        return {
          ...expected,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return [...runArtifacts, ...postGateArtifacts];
}

/** Builds the immutable binding copied into a post-gate independent review. */
export function buildBlockerReviewGateRunBinding(runDocument, resultsSha256, artifacts) {
  const reasons = [];
  if (!isSha256(resultsSha256)) reasons.push('gate results SHA-256 is invalid');
  if (!validTimestamp(runDocument?.startedAt)) reasons.push('gate run startedAt is invalid');
  if (!validTimestamp(runDocument?.endedAt)) reasons.push('gate run endedAt is invalid');
  const sourceManifestSha256 = runDocument?.sourceIdentityAfter?.manifestSha256;
  if (!isSha256(sourceManifestSha256)) reasons.push('gate run source manifest SHA-256 is invalid');
  const runValidation = validateGateRunDocument(runDocument, sourceManifestSha256);
  if (!runValidation.passed) {
    reasons.push(...runValidation.reasons.map(reason => `gate run is invalid: ${reason}`));
  }

  const commands = Array.isArray(runDocument?.commands) ? runDocument.commands : [];
  const commandsByName = new Map(commands.map(command => [command?.command, command]));
  const actualArtifacts = Array.isArray(artifacts) ? artifacts : [];
  if (!Array.isArray(artifacts)) reasons.push('review artifacts must be an array');
  if (actualArtifacts.length !== PHASE_1_BLOCKER_REVIEW_ARTIFACTS.length) {
    reasons.push(
      `review artifact count must equal ${PHASE_1_BLOCKER_REVIEW_ARTIFACTS.length.toString()}`,
    );
  }

  const files = [];
  for (const [index, expected] of PHASE_1_BLOCKER_REVIEW_ARTIFACTS.entries()) {
    const actual = actualArtifacts[index];
    if (
      actual?.file !== expected.file ||
      actual?.command !== expected.command ||
      actual?.freshness !== expected.freshness
    ) {
      reasons.push(`review artifact ${index.toString()} differs from the required policy`);
    }
    if (!Number.isSafeInteger(actual?.bytes) || actual.bytes <= 0) {
      reasons.push(`review artifact ${expected.file} has invalid bytes`);
    }
    if (!isSha256(actual?.sha256)) {
      reasons.push(`review artifact ${expected.file} has invalid SHA-256`);
    }
    if (!validTimestamp(actual?.mtime)) {
      reasons.push(`review artifact ${expected.file} has invalid mtime`);
    }
    if (expected.freshness === 'post-run') {
      const mtime =
        typeof actual?.mtimeMs === 'number' ? actual.mtimeMs : Date.parse(actual?.mtime);
      const runEndedAt = Date.parse(runDocument?.endedAt);
      if (!Number.isFinite(mtime) || !Number.isFinite(runEndedAt) || mtime < runEndedAt) {
        reasons.push(`post-run document ${expected.file} predates the gate run completion`);
      }
    } else {
      const gate = commandsByName.get(expected.command);
      if (gate?.exitCode !== 0) {
        reasons.push(`review artifact ${expected.file} was produced by a failed command`);
      }
      if (!timestampInGateWindow(actual?.mtimeMs ?? actual?.mtime, gate)) {
        reasons.push(`review artifact ${expected.file} is not fresh for ${expected.command}`);
      }
    }
    files.push({
      file: expected.file,
      ...(expected.command === undefined ? {} : { command: expected.command }),
      ...(expected.freshness === undefined ? {} : { freshness: expected.freshness }),
      bytes: actual?.bytes ?? null,
      sha256: actual?.sha256 ?? null,
      mtime: actual?.mtime ?? null,
    });
  }

  const runnerArtifactFiles = files.slice(0, PHASE_1_RUN_ARTIFACTS.length);
  if (stableJson(runDocument?.postflight?.artifacts?.files) !== stableJson(runnerArtifactFiles)) {
    reasons.push('current runner artifacts differ from the gate postflight binding');
  }
  if (runDocument?.postflight?.artifacts?.setSha256 !== sha256(stableJson(runnerArtifactFiles))) {
    reasons.push('gate postflight artifact set SHA-256 differs from current runner artifacts');
  }

  const binding = {
    resultsSha256,
    startedAt: runDocument?.startedAt ?? null,
    endedAt: runDocument?.endedAt ?? null,
    sourceManifestSha256: sourceManifestSha256 ?? null,
    artifacts: {
      files,
      setSha256: sha256(stableJson(files)),
    },
  };
  return { passed: reasons.length === 0, reasons, binding };
}

export function strictVitestSummary(document, expectedTests) {
  const reasons = [];
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const fields = [
    'numTotalTestSuites',
    'numPassedTestSuites',
    'numFailedTestSuites',
    'numPendingTestSuites',
    'numTotalTests',
    'numPassedTests',
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
  ];
  for (const field of fields) {
    if (!integer(document?.[field])) reasons.push(`${field} must be a non-negative safe integer`);
  }
  if (document?.success !== true) reasons.push('success must be true');
  if (document?.numTotalTests !== expectedTests) {
    reasons.push(`numTotalTests must equal the reviewed count ${expectedTests.toString()}`);
  }
  if (document?.numPassedTests !== expectedTests) {
    reasons.push(`numPassedTests must equal ${expectedTests.toString()}`);
  }
  if (document?.numFailedTests !== 0) reasons.push('numFailedTests must be zero');
  if (document?.numPendingTests !== 0) reasons.push('numPendingTests must be zero');
  if (document?.numTodoTests !== 0) reasons.push('numTodoTests must be zero');
  if (document?.numTotalTestSuites <= 0) reasons.push('numTotalTestSuites must be positive');
  if (document?.numPassedTestSuites !== document?.numTotalTestSuites) {
    reasons.push('every test suite must pass');
  }
  if (document?.numFailedTestSuites !== 0) reasons.push('numFailedTestSuites must be zero');
  if (document?.numPendingTestSuites !== 0) reasons.push('numPendingTestSuites must be zero');

  const results = Array.isArray(document?.testResults) ? document.testResults : [];
  if (results.length === 0) reasons.push('testResults must contain per-file results');
  const assertions = results.flatMap(result =>
    Array.isArray(result?.assertionResults) ? result.assertionResults : [],
  );
  if (assertions.length !== expectedTests) {
    reasons.push(`testResults must contain ${expectedTests.toString()} assertions`);
  }
  if (results.some(result => result?.status !== 'passed')) {
    reasons.push('every testResults entry must have passed status');
  }
  if (assertions.some(assertion => assertion?.status !== 'passed')) {
    reasons.push('every assertion must have passed status');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    summary: {
      success: document?.success === true,
      startTime: document?.startTime ?? null,
      suites: {
        total: document?.numTotalTestSuites ?? null,
        passed: document?.numPassedTestSuites ?? null,
        failed: document?.numFailedTestSuites ?? null,
        pending: document?.numPendingTestSuites ?? null,
      },
      tests: {
        expected: expectedTests,
        total: document?.numTotalTests ?? null,
        passed: document?.numPassedTests ?? null,
        failed: document?.numFailedTests ?? null,
        pending: document?.numPendingTests ?? null,
        todo: document?.numTodoTests ?? null,
      },
      assertionCount: assertions.length,
    },
  };
}

function exactStringSet(actual, expected) {
  if (!Array.isArray(actual)) return false;
  return (
    new Set(actual).size === actual.length &&
    stableJson([...actual].sort()) === stableJson([...expected].sort())
  );
}

function aelionTarballName(packageName, version) {
  return `${packageName.slice(1).replace('/', '-')}-${version}.tgz`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveSafeIntegerValue(value) {
  return Number.isSafeInteger(value) && value > 0;
}

const PHASE_1_REFERENCE_DEVICE_FIELDS = Object.freeze([
  'architecture',
  'browser',
  'browserVersion',
  'cpu',
  'logicalCpuCount',
  'memoryBytes',
  'memoryGiB',
  'model',
  'os',
  'osBuild',
  'osVersion',
  'physicalCoreCount',
  'platform',
  'probe',
  'userAgent',
]);

function validateBrowserIdentity(report, browser, scope, reasons) {
  const version = report?.browserVersion;
  const userAgent = report?.userAgent;
  const versionMatch = typeof version === 'string' ? version.match(/^(\d+)(?:\.\d+){1,4}$/u) : null;
  if (versionMatch === null) reasons.push(`${scope} browserVersion is invalid`);
  if (!nonEmptyString(userAgent)) reasons.push(`${scope} userAgent is missing`);
  if (!nonEmptyString(browser) || (versionMatch !== null && !browser.endsWith(` ${version}`))) {
    reasons.push(`${scope} browser label is not bound to browserVersion`);
  }
  if (
    versionMatch !== null &&
    nonEmptyString(userAgent) &&
    !new RegExp(`(?:Chrome|Chromium)/${versionMatch[1]}(?:\\.|\\s|$)`, 'u').test(userAgent)
  ) {
    reasons.push(`${scope} browser process and userAgent major versions differ`);
  }
}

function validateReferenceDevice(report, scope, reasons) {
  const device = report?.referenceDevice;
  if (device === null || typeof device !== 'object' || Array.isArray(device)) {
    reasons.push(`${scope} referenceDevice must be an object`);
    return;
  }
  if (!exactStringSet(Object.keys(device), PHASE_1_REFERENCE_DEVICE_FIELDS)) {
    reasons.push(`${scope} referenceDevice fields differ from the privacy-reviewed allowlist`);
  }
  for (const field of ['model', 'cpu', 'os', 'platform', 'architecture', 'osVersion']) {
    if (!nonEmptyString(device[field]))
      reasons.push(`${scope} referenceDevice.${field} is missing`);
  }
  if (!positiveSafeIntegerValue(device.logicalCpuCount)) {
    reasons.push(`${scope} referenceDevice.logicalCpuCount is invalid`);
  }
  if (
    device.physicalCoreCount !== null &&
    (!positiveSafeIntegerValue(device.physicalCoreCount) ||
      device.physicalCoreCount > device.logicalCpuCount)
  ) {
    reasons.push(`${scope} referenceDevice.physicalCoreCount is invalid`);
  }
  if (
    !positiveSafeIntegerValue(device.memoryBytes) ||
    !positiveSafeIntegerValue(device.memoryGiB) ||
    device.memoryGiB !== Math.max(1, Math.round(device.memoryBytes / 1_073_741_824))
  ) {
    reasons.push(`${scope} referenceDevice memory fields are invalid or inconsistent`);
  }
  if (device.osBuild !== null && !nonEmptyString(device.osBuild)) {
    reasons.push(`${scope} referenceDevice.osBuild is invalid`);
  }
  const probe = device.probe;
  if (
    probe === null ||
    typeof probe !== 'object' ||
    Array.isArray(probe) ||
    !exactStringSet(Object.keys(probe), ['limitations', 'source']) ||
    !nonEmptyString(probe.source) ||
    !probe.source.split('+').includes('node:os') ||
    !Array.isArray(probe.limitations) ||
    probe.limitations.some(value => !nonEmptyString(value))
  ) {
    reasons.push(`${scope} referenceDevice probe provenance is invalid`);
  }
  if (device.platform === 'darwin') {
    if (
      device.physicalCoreCount === null ||
      !nonEmptyString(device.osBuild) ||
      probe?.source !== 'node:os+system_profiler+sw_vers' ||
      probe?.limitations?.length !== 0 ||
      !device.os.includes(device.osVersion) ||
      !device.os.includes(device.osBuild)
    ) {
      reasons.push(`${scope} Darwin referenceDevice lacks full hardware/OS probe provenance`);
    }
  }
  validateBrowserIdentity(device, device.browser, `${scope} referenceDevice`, reasons);
  if (report?.browserVersion !== device.browserVersion || report?.userAgent !== device.userAgent) {
    reasons.push(`${scope} top-level browser identity differs from referenceDevice`);
  }
  if (/(?:serial|uuid|udid|hostname)/iu.test(JSON.stringify(device))) {
    reasons.push(`${scope} referenceDevice contains a forbidden identifying field or value`);
  }
}

const PHASE_1_SEEK_TARGETS_US = Object.freeze([550_000, 1_050_000, 1_550_000, 2_550_000]);
const PHASE_1_SEEK_FIXTURES = Object.freeze([
  Object.freeze({
    name: 'mp4-moov-head-h264-aac.mp4',
    container: 'mp4',
    presentationsUs: Object.freeze([533_333, 1_033_333, 1_533_333, 2_533_333]),
  }),
  Object.freeze({
    name: 'mp4-moov-tail-h264-aac.mp4',
    container: 'mp4',
    presentationsUs: Object.freeze([533_333, 1_033_333, 1_533_333, 2_533_333]),
  }),
  Object.freeze({
    name: 'mp4-fragmented-h264-aac.mp4',
    container: 'mp4',
    presentationsUs: Object.freeze([533_333, 1_033_333, 1_533_333, 2_533_333]),
  }),
  Object.freeze({
    name: 'mp4-nonzero-pts-h264-aac.mp4',
    container: 'mp4',
    presentationsUs: Object.freeze([533_333, 1_033_333, 1_533_333, 2_533_333]),
  }),
  Object.freeze({
    name: 'webm-vp9-opus-vfr.webm',
    container: 'webm',
    presentationsUs: Object.freeze([533_000, 1_000_000, 1_533_000, 2_533_000]),
  }),
]);

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

/** Strict Phase 1 exact-seek evidence contract. */
export function validateSeekEvidence(report) {
  const reasons = [];
  if (report?.evidenceVersion !== '1.0.0') reasons.push('seek evidenceVersion must be 1.0.0');
  if (report?.command !== 'corepack pnpm report:seek') reasons.push('seek command differs');
  validateBrowserIdentity(report, report?.browser, 'seek', reasons);
  if (stableJson(report?.targetsUs) !== stableJson(PHASE_1_SEEK_TARGETS_US)) {
    reasons.push('seek targets differ from the fixed contract');
  }
  const fixtures = Array.isArray(report?.fixtures) ? report.fixtures : [];
  if (
    !exactStringSet(
      fixtures.map(value => value?.name),
      PHASE_1_SEEK_FIXTURES.map(x => x.name),
    )
  ) {
    reasons.push('seek fixture set differs from the fixed corpus');
  }
  for (const expected of PHASE_1_SEEK_FIXTURES) {
    const fixture = fixtures.find(value => value?.name === expected.name);
    if (fixture === undefined) continue;
    if (fixture.container !== expected.container)
      reasons.push(`${expected.name} container differs`);
    if (!positiveSafeIntegerValue(fixture.bytes))
      reasons.push(`${expected.name} bytes are invalid`);
    if (!nonEmptyString(fixture.codec)) reasons.push(`${expected.name} codec is missing`);
    if (!finiteNonNegative(fixture.indexMs)) reasons.push(`${expected.name} indexMs is invalid`);
    for (const [kind, count] of [
      ['cold', PHASE_1_SEEK_TARGETS_US.length],
      ['warm', PHASE_1_SEEK_TARGETS_US.length * 3],
    ]) {
      const group = fixture[kind];
      const samples = Array.isArray(group?.samples) ? group.samples : [];
      if (group?.count !== count || samples.length !== count) {
        reasons.push(`${expected.name} ${kind} sample count differs`);
      }
      const repetitions = kind === 'cold' ? 1 : 3;
      const expectedTargets = Array.from(
        { length: repetitions },
        () => PHASE_1_SEEK_TARGETS_US,
      ).flat();
      const expectedPresentations = Array.from(
        { length: repetitions },
        () => expected.presentationsUs,
      ).flat();
      if (stableJson(samples.map(sample => sample?.targetUs)) !== stableJson(expectedTargets)) {
        reasons.push(`${expected.name} ${kind} target order/multiplicity differs`);
      }
      if (
        stableJson(samples.map(sample => sample?.presentationUs)) !==
        stableJson(expectedPresentations)
      ) {
        reasons.push(`${expected.name} ${kind} presentation timestamps differ from the oracle`);
      }
      for (const sample of samples) {
        if (
          !Number.isSafeInteger(sample?.presentationUs) ||
          sample.presentationUs < 0 ||
          !Number.isSafeInteger(sample?.targetUs) ||
          sample.presentationUs > sample.targetUs
        ) {
          reasons.push(`${expected.name} ${kind} target/presentation binding is invalid`);
        }
        if (!finiteNonNegative(sample?.elapsedMs)) {
          reasons.push(`${expected.name} ${kind} elapsedMs is invalid`);
        }
        if (
          !positiveSafeIntegerValue(sample?.decodedPackets) ||
          sample.decodedPackets !== sample?.plannedPackets
        ) {
          reasons.push(`${expected.name} ${kind} decode plan was not followed exactly`);
        }
      }
      const elapsed = samples.map(sample => sample?.elapsedMs);
      if (
        elapsed.some(value => !finiteNonNegative(value)) ||
        !approximatelyEqual(group?.p50Ms, percentile(elapsed, 0.5)) ||
        !approximatelyEqual(group?.p95Ms, percentile(elapsed, 0.95)) ||
        !approximatelyEqual(group?.maxMs, Math.max(0, ...elapsed))
      ) {
        reasons.push(`${expected.name} ${kind} latency statistics differ from the samples`);
      }
    }
    if (!finiteNonNegative(fixture.cold?.p95Ms) || fixture.cold.p95Ms > 350) {
      reasons.push(`${expected.name} cold p95 exceeds 350 ms`);
    }
    if (!finiteNonNegative(fixture.warm?.p95Ms) || fixture.warm.p95Ms > 100) {
      reasons.push(`${expected.name} warm p95 exceeds 100 ms`);
    }
    if (
      fixture.sampleIndex?.capabilities?.timingAndSize !== true ||
      !Array.isArray(fixture.sampleIndex?.diagnostics)
    ) {
      reasons.push(`${expected.name} SampleIndex capability contract differs`);
    }
  }
  if (report?.resources?.activeDecoders !== 0 || report?.resources?.retainedFrames !== 0) {
    reasons.push('seek decoder/frame resources were not drained');
  }
  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      fixtureCount: fixtures.length,
      targetsUs: report?.targetsUs ?? null,
      resources: report?.resources ?? null,
    },
  };
}

function validateCompositorBenchmark(value, options, reasons) {
  const resolution = options.resolution ?? { width: 1_920, height: 1_080 };
  if (
    value?.resolution?.width !== resolution.width ||
    value?.resolution?.height !== resolution.height
  ) {
    reasons.push(`${options.name} resolution differs`);
  }
  if (value?.frames !== options.frames || value?.passCount !== options.passes) {
    reasons.push(`${options.name} frame/pass contract differs`);
  }
  const wallP50Ms = value?.wall?.p50Ms;
  const wallP95Ms = value?.wall?.p95Ms;
  if (
    !finiteNonNegative(wallP50Ms) ||
    wallP50Ms <= 0 ||
    !finiteNonNegative(wallP95Ms) ||
    wallP95Ms < wallP50Ms ||
    !finiteNonNegative(value?.throughputFps) ||
    !approximatelyEqual(value.throughputFps, 1_000 / wallP50Ms)
  ) {
    reasons.push(`${options.name} wall latency/throughput statistics are invalid or inconsistent`);
  }
  for (const [label, statistics] of [
    ['worker', value?.worker],
    ['GPU completion', value?.gpuCompletion],
  ]) {
    if (
      !finiteNonNegative(statistics?.p50Us) ||
      !finiteNonNegative(statistics?.p95Us) ||
      statistics.p95Us < statistics.p50Us
    ) {
      reasons.push(`${options.name} ${label} statistics are invalid or inconsistent`);
    }
  }
  if (options.maxP95Ms !== undefined && value?.wall?.p95Ms > options.maxP95Ms) {
    reasons.push(`${options.name} p95 exceeds ${options.maxP95Ms.toString()} ms`);
  }
  const before = value?.resourcesBeforeDispose;
  const after = value?.resourcesAfterDispose;
  if (before?.disposed !== false || before?.pendingRequests !== 0) {
    reasons.push(`${options.name} pre-dispose admission differs`);
  }
  if (after?.disposed !== true || after?.pendingRequests !== 0) {
    reasons.push(`${options.name} compositor did not terminate and drain`);
  }
}

function approximatelyEqual(left, right, epsilon = 0.001) {
  return (
    typeof left === 'number' &&
    Number.isFinite(left) &&
    typeof right === 'number' &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= epsilon
  );
}

function validateLongTaskWindow(name, window, reasons) {
  const startedAtMs = window?.startedAtMs;
  const completedAtMs = window?.completedAtMs;
  if (
    window?.supported !== true ||
    !finiteNonNegative(startedAtMs) ||
    !finiteNonNegative(completedAtMs) ||
    completedAtMs <= startedAtMs ||
    !approximatelyEqual(window?.elapsedMs, completedAtMs - startedAtMs)
  ) {
    reasons.push(`${name} Long Task window is unsupported, empty or internally inconsistent`);
  }
  const tasks = Array.isArray(window?.tasks) ? window.tasks : [];
  if (!Array.isArray(window?.tasks)) reasons.push(`${name} Long Task tasks must be an array`);
  for (const task of tasks) {
    const start = task?.startTimeMs;
    const duration = task?.durationMs;
    const end = task?.endTimeMs;
    const expectedOverlap = Math.min(end, completedAtMs) - Math.max(start, startedAtMs);
    if (
      !finiteNonNegative(start) ||
      !finiteNonNegative(duration) ||
      duration <= 0 ||
      !approximatelyEqual(end, start + duration) ||
      !(start < completedAtMs && end > startedAtMs) ||
      expectedOverlap <= 0 ||
      !approximatelyEqual(task?.overlapMs, expectedOverlap)
    ) {
      reasons.push(`${name} contains an invalid or non-intersecting Long Task`);
    }
  }
  const expectedCount = tasks.filter(task => task?.durationMs > 50).length;
  const expectedMaximum = Math.max(0, ...tasks.map(task => task?.durationMs ?? Number.NaN));
  if (window?.longTasksOver50Ms !== expectedCount) {
    reasons.push(`${name} Long Task count differs from its task list`);
  }
  if (!approximatelyEqual(window?.maxLongTaskMs, expectedMaximum)) {
    reasons.push(`${name} maximum Long Task differs from its task list`);
  }
}

function sameLongTaskIdentity(left, right) {
  return (
    approximatelyEqual(left?.startTimeMs, right?.startTimeMs) &&
    approximatelyEqual(left?.durationMs, right?.durationMs) &&
    approximatelyEqual(left?.endTimeMs, right?.endTimeMs)
  );
}

function validateExportMainThread(exported, reasons) {
  const mainThread = exported?.mainThread;
  const initialization = mainThread?.initialization;
  const steady = mainThread?.steady;
  const overall = mainThread?.overall;
  validateLongTaskWindow('performance initialization', initialization, reasons);
  validateLongTaskWindow('performance steady state', steady, reasons);
  validateLongTaskWindow('performance overall', overall, reasons);
  if (
    !approximatelyEqual(initialization?.startedAtMs, overall?.startedAtMs) ||
    !approximatelyEqual(initialization?.completedAtMs, steady?.startedAtMs) ||
    !approximatelyEqual(steady?.completedAtMs, overall?.completedAtMs) ||
    !approximatelyEqual(initialization?.elapsedMs + steady?.elapsedMs, overall?.elapsedMs)
  ) {
    reasons.push(
      'performance initialization and steady Long Task windows do not continuously cover overall',
    );
  }

  const overallTasks = Array.isArray(overall?.tasks) ? overall.tasks : [];
  for (const [name, window] of [
    ['initialization', initialization],
    ['steady', steady],
  ]) {
    const windowTasks = Array.isArray(window?.tasks) ? window.tasks : [];
    const expectedTasks = overallTasks.filter(
      task => task?.startTimeMs < window?.completedAtMs && task?.endTimeMs > window?.startedAtMs,
    );
    if (
      windowTasks.length !== expectedTasks.length ||
      windowTasks.some((task, index) => !sameLongTaskIdentity(task, expectedTasks[index]))
    ) {
      reasons.push(
        `performance ${name} Long Tasks differ from conservative intersection slicing of overall`,
      );
    }
  }

  const expectedPhaseNames = [
    'export-call',
    'first-video-render-start',
    'first-video-render-end',
    'second-video-render-start',
    'video-complete',
    'first-audio-render-start',
    'first-audio-render-end',
    'export-complete',
  ];
  const phases = Array.isArray(exported?.phases) ? exported.phases : [];
  const phaseNames = phases.map(phase => phase?.name);
  if (stableJson(phaseNames) !== stableJson(expectedPhaseNames)) {
    reasons.push('performance phase names must be unique and in the reviewed order');
  }
  if (
    phases.some(
      (phase, index) =>
        !finiteNonNegative(phase?.atMs) || (index > 0 && phase.atMs < phases[index - 1]?.atMs),
    )
  ) {
    reasons.push('performance phase timestamps must be finite and monotonic');
  }
  const phaseTime = name => phases.find(phase => phase?.name === name)?.atMs;
  if (
    phaseTime('export-call') < overall?.startedAtMs ||
    phaseTime('export-complete') > overall?.completedAtMs ||
    !approximatelyEqual(phaseTime('second-video-render-start'), initialization?.completedAtMs)
  ) {
    reasons.push('performance phases fall outside the measured window or differ from its boundary');
  }
}

/** Strict fixed-environment Phase 1 1080p30/resource evidence contract. */
export function validatePerformanceEvidence(report) {
  const reasons = [];
  if (report?.evidenceVersion !== '1.0.0') {
    reasons.push('performance evidenceVersion must be 1.0.0');
  }
  if (report?.command !== 'corepack pnpm report:performance') {
    reasons.push('performance command differs');
  }
  if (report?.fixture !== 'Aelion 1080p30 SDR reference') {
    reasons.push('performance fixture differs');
  }
  validateReferenceDevice(report, 'performance', reasons);
  validateCompositorBenchmark(
    report?.material?.warmFilmWebGl2,
    { name: 'Warm Film WebGL2', frames: 30, passes: 1, maxP95Ms: 1_000 / 30 },
    reasons,
  );
  validateCompositorBenchmark(
    report?.material?.warmFilmWebGpu,
    { name: 'Warm Film WebGPU', frames: 30, passes: 1 },
    reasons,
  );
  validateCompositorBenchmark(
    report?.material?.softGlow,
    { name: 'Soft Glow WebGL2', frames: 12, passes: 4 },
    reasons,
  );
  validateCompositorBenchmark(
    report?.material?.fourKWebGl2,
    {
      name: 'Warm Film 4K WebGL2',
      frames: 3,
      passes: 1,
      resolution: { width: 3_840, height: 2_160 },
    },
    reasons,
  );
  const exported = report?.export;
  const expectedRealtimeMultiple = exported?.durationUs / 1_000 / exported?.elapsedMs;
  if (
    exported?.resolution?.width !== 1_920 ||
    exported?.resolution?.height !== 1_080 ||
    exported?.durationUs !== 5_000_000 ||
    exported?.videoFrames !== 150 ||
    exported?.audioFrames !== 240_000 ||
    !finiteNonNegative(exported?.elapsedMs) ||
    exported.elapsedMs <= 0 ||
    !finiteNonNegative(exported?.realtimeMultiple) ||
    exported.realtimeMultiple < 1 ||
    !approximatelyEqual(exported.realtimeMultiple, expectedRealtimeMultiple)
  ) {
    reasons.push('1080p30 export correctness/throughput contract differs');
  }
  if (
    !positiveSafeIntegerValue(exported?.bytes) ||
    exported?.sink?.finalSize !== exported.bytes ||
    !positiveSafeIntegerValue(exported?.sink?.writes) ||
    !positiveSafeIntegerValue(exported?.sink?.bytesWritten) ||
    exported.sink.bytesWritten < exported.sink.finalSize ||
    exported?.sink?.maxInFlightWrites !== 1 ||
    exported?.sink?.closed !== true ||
    exported?.sink?.aborted !== false
  ) {
    reasons.push(
      'performance export byte/sink statistics are inconsistent or not bounded and closed',
    );
  }
  if (
    exported?.mainThread?.contract !==
    'worker encoder/mux orchestration; host frame production disclosed; steady-state begins at the second video frame'
  ) {
    reasons.push('performance export Long Task attribution contract differs');
  }
  validateExportMainThread(exported, reasons);
  if (!approximatelyEqual(exported?.elapsedMs, exported?.mainThread?.overall?.elapsedMs)) {
    reasons.push('performance export elapsedMs differs from the measured overall window');
  }
  if (exported?.mainThread?.steady?.longTasksOver50Ms !== 0) {
    reasons.push('performance export steady state observed a >50 ms main-thread Long Task');
  }
  if (
    !finiteNonNegative(exported?.mainThread?.initialization?.elapsedMs) ||
    !finiteNonNegative(exported?.mainThread?.overall?.elapsedMs)
  ) {
    reasons.push('performance export initialization/overall Long Task windows are invalid');
  }
  const timeline = report?.longTimeline;
  if (
    timeline?.simulatedDurationUs !== 600_000_000 ||
    !finiteNonNegative(timeline?.elapsedMs) ||
    timeline.elapsedMs <= 0 ||
    timeline?.boundedBytes !== 32_800 ||
    timeline?.pcm?.capacityFrames !== 4_096 ||
    timeline?.pcm?.availableReadFrames !== 0 ||
    timeline?.pcm?.availableWriteFrames !== 4_096 ||
    timeline?.pcm?.playedFrames !== 28_800_000 ||
    timeline?.pcm?.underrunFrames !== 0 ||
    timeline?.pcm?.state !== 'open'
  ) {
    reasons.push('ten-minute bounded PCM simulation contract differs');
  }
  const heapSamples = Array.isArray(timeline?.heapSamples) ? timeline.heapSamples : [];
  if (
    heapSamples.length !== 10 ||
    heapSamples.some(
      (sample, index) =>
        sample?.equivalentMinute !== index + 1 ||
        (sample?.usedJsHeapBytes !== null && !finiteNonNegative(sample?.usedJsHeapBytes)),
    )
  ) {
    reasons.push('ten-minute heap sampling contract differs');
  }
  const measuredHeapSamples = heapSamples
    .map(sample => sample?.usedJsHeapBytes)
    .filter(value => value !== null);
  const firstHalfMaximum = Math.max(0, ...measuredHeapSamples.slice(0, 5));
  const secondHalfMaximum = Math.max(0, ...measuredHeapSamples.slice(5));
  if (
    measuredHeapSamples.length > 0 &&
    (measuredHeapSamples.length !== 10 ||
      Math.max(...measuredHeapSamples) > 64 * 1_024 * 1_024 ||
      secondHalfMaximum > firstHalfMaximum + 16 * 1_024 * 1_024)
  ) {
    reasons.push('ten-minute heap samples exceed the bounded non-linear-growth envelope');
  }
  for (const [name, snapshot] of [
    ['before', timeline?.memory?.before],
    ['after', timeline?.memory?.after],
  ]) {
    if (
      snapshot?.usedJsHeapBytes !== null &&
      (!finiteNonNegative(snapshot?.usedJsHeapBytes) ||
        !finiteNonNegative(snapshot?.totalJsHeapBytes) ||
        snapshot.usedJsHeapBytes > snapshot.totalJsHeapBytes ||
        snapshot.totalJsHeapBytes > 128 * 1_024 * 1_024)
    ) {
      reasons.push(`ten-minute ${name} heap snapshot is invalid or unbounded`);
    }
  }
  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      webGl2P95Ms: report?.material?.warmFilmWebGl2?.wall?.p95Ms ?? null,
      exportRealtimeMultiple: exported?.realtimeMultiple ?? null,
      steadyLongTasksOver50Ms: exported?.mainThread?.steady?.longTasksOver50Ms ?? null,
      initializationLongTasksOver50Ms:
        exported?.mainThread?.initialization?.longTasksOver50Ms ?? null,
      pcm: timeline?.pcm ?? null,
    },
  };
}

function validateTarballBrowser(entry, reasons) {
  const browser = entry?.browser;
  const report = entry?.report;
  if (!['chromium', 'firefox'].includes(browser)) return;
  if (!nonEmptyString(report?.userAgent)) reasons.push(`${browser} userAgent is missing`);
  if (report?.crossOriginIsolated !== true) reasons.push(`${browser} is not cross-origin isolated`);
  const compositor = report?.workerCompositor;
  if (compositor?.backend !== 'webgl2')
    reasons.push(`${browser} Worker compositor backend differs`);
  if (!nonEmptyString(compositor?.graphHash)) reasons.push(`${browser} graph hash is missing`);
  const expectedPixel = [245, 235, 225, 255];
  if (
    !Array.isArray(compositor?.pixel) ||
    compositor.pixel.length !== expectedPixel.length ||
    compositor.pixel.some(
      (value, index) => !Number.isInteger(value) || Math.abs(value - expectedPixel[index]) > 2,
    )
  ) {
    reasons.push(`${browser} Worker compositor pixel contract differs`);
  }
  if (!finiteNonNegative(compositor?.workerTimingUs)) {
    reasons.push(`${browser} Worker timing is invalid`);
  }
  const audio = report?.audioWorkletClock;
  if (
    audio?.contextState !== 'suspended' ||
    audio?.sampleRate !== 48_000 ||
    audio?.quantumFrames !== 128 ||
    audio?.queuedFrames !== 24_000 ||
    audio?.capacityFrames !== 96_000 ||
    !positiveSafeIntegerValue(audio?.playedFrames) ||
    audio.playedFrames % audio.quantumFrames !== 0 ||
    audio.playedFrames > audio.queuedFrames ||
    audio?.availableReadFrames !== audio.queuedFrames - audio.playedFrames ||
    audio?.underrunFrames !== 0 ||
    !Number.isSafeInteger(audio?.timeUs) ||
    audio.timeUs <= 0
  ) {
    reasons.push(`${browser} AudioWorklet consumer contract differs`);
  }
  const session = report?.sessionFacade;
  if (
    session?.revision !== '3' ||
    session?.state !== 'ready' ||
    session?.backend !== 'webgl2' ||
    session?.width !== 16 ||
    session?.height !== 16
  ) {
    reasons.push(`${browser} Session consumer contract differs`);
  }
}

export function validateTarballConsumer(report, expectedVersion) {
  const reasons = [];
  if (report?.schemaVersion !== '1.0.0') reasons.push('schemaVersion must be 1.0.0');
  if (report?.command !== 'corepack pnpm test:consumer') reasons.push('command differs');
  if (report?.sdkVersion !== expectedVersion) reasons.push('sdkVersion differs');

  const packages = Array.isArray(report?.packages) ? report.packages : [];
  const packageNames = packages.map(entry => entry?.name);
  if (!exactStringSet(packageNames, PHASE_1_EXPECTED_PUBLIC_PACKAGES)) {
    reasons.push('public package names do not match the exact reviewed set');
  }
  const packageHashes = [];
  for (const name of PHASE_1_EXPECTED_PUBLIC_PACKAGES) {
    const matches = packages.filter(entry => entry?.name === name);
    if (matches.length !== 1) continue;
    const entry = matches[0];
    if (entry.version !== expectedVersion) reasons.push(`${name} version differs`);
    if (!isSha256(entry.sha256)) reasons.push(`${name} tarball SHA-256 is invalid`);
    else packageHashes.push(entry.sha256);
  }
  if (new Set(packageHashes).size !== packageHashes.length) {
    reasons.push('public package tarball hashes must be unique');
  }

  const runtimeAssets = Array.isArray(report?.runtimeAssets) ? report.runtimeAssets : [];
  if (
    !exactStringSet(
      runtimeAssets.map(entry => entry?.id),
      PHASE_1_EXPECTED_RUNTIME_ASSETS,
    )
  ) {
    reasons.push('runtime asset ids do not match the exact reviewed set');
  }
  const runtimeHashes = [];
  for (const id of PHASE_1_EXPECTED_RUNTIME_ASSETS) {
    const matches = runtimeAssets.filter(entry => entry?.id === id);
    if (matches.length !== 1) continue;
    const entry = matches[0];
    if (
      !nonEmptyString(entry.file) ||
      !entry.file.startsWith('dist/assets/') ||
      !nonEmptyString(entry.publicUrl) ||
      entry.publicUrl !== entry.file.slice('dist'.length)
    ) {
      reasons.push(`${id} runtime URL/file identity differs`);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      reasons.push(`${id} runtime byte size is invalid`);
    }
    if (!isSha256(entry.sha256)) reasons.push(`${id} runtime SHA-256 is invalid`);
    else runtimeHashes.push(entry.sha256);
  }
  if (new Set(runtimeHashes).size !== runtimeHashes.length) {
    reasons.push('runtime asset hashes must be unique');
  }

  const adapter = report?.bundlerAdapter;
  const pluginPackage = packages.find(entry => entry?.name === '@aelion/vite-plugin');
  if (
    adapter?.id !== '@aelion/vite-plugin' ||
    adapter?.package !== '@aelion/vite-plugin' ||
    adapter?.version !== expectedVersion ||
    adapter?.public !== true ||
    adapter?.zeroConfigVite !== false ||
    adapter?.packageSha256 !== pluginPackage?.sha256 ||
    !isSha256(adapter?.contractSha256) ||
    !isSha256(adapter?.viteConfigSha256) ||
    !nonEmptyString(adapter?.configuration)
  ) {
    reasons.push('public Vite adapter identity/contract differs');
  }

  const consumer = report?.consumerContract;
  if (consumer?.typecheck !== 'node node_modules/typescript/bin/tsc --noEmit') {
    reasons.push('consumer typecheck command differs');
  }
  for (const field of ['packageJsonSha256', 'sourceSha256', 'tsconfigSha256']) {
    if (!isSha256(consumer?.[field])) reasons.push(`consumer ${field} is invalid`);
  }
  const dependencyContract = consumer?.dependencyContract;
  if (
    dependencyContract === null ||
    typeof dependencyContract !== 'object' ||
    Array.isArray(dependencyContract)
  ) {
    reasons.push('consumer dependencyContract is invalid');
  } else {
    if (sha256(stableJson(dependencyContract)) !== consumer?.dependencyContractSha256) {
      reasons.push('consumer dependencyContract SHA-256 differs');
    }
    for (const name of PHASE_1_EXPECTED_PUBLIC_PACKAGES) {
      if (dependencyContract[name] !== aelionTarballName(name, expectedVersion)) {
        reasons.push(`${name} consumer tarball dependency differs`);
      }
    }
  }

  const browsers = Array.isArray(report?.browsers) ? report.browsers : [];
  if (
    !exactStringSet(
      browsers.map(entry => entry?.browser),
      ['chromium', 'firefox'],
    )
  ) {
    reasons.push('tarball browser set must be exactly Chromium and Firefox');
  }
  browsers.forEach(entry => validateTarballBrowser(entry, reasons));

  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      packageCount: packages.length,
      packageNames,
      packageContractSha256: sha256(stableJson(packages)),
      runtimeAssetCount: runtimeAssets.length,
      runtimeAssetIds: runtimeAssets.map(entry => entry?.id),
      runtimeAssetContractSha256: sha256(stableJson(runtimeAssets)),
      browsers: browsers.map(entry => entry?.browser),
      consumerDependencyContractSha256: consumer?.dependencyContractSha256 ?? null,
    },
  };
}

const ALPHA_ZERO_RESOURCE_FIELDS = Object.freeze([
  'assets',
  'cachedBytes',
  'inFlightAssetLoads',
  'inFlightSampleIndexes',
  'inFlightRequests',
  'sharedOperationSubscribers',
  'activeOperations',
  'pendingOperations',
  'activeLoads',
  'pendingLoads',
]);

const ALPHA_IDLE_BEFORE_DISPOSE_FIELDS = Object.freeze([
  'inFlightAssetLoads',
  'inFlightSampleIndexes',
  'inFlightRequests',
  'sharedOperationSubscribers',
  'activeOperations',
  'pendingOperations',
  'activeLoads',
  'pendingLoads',
]);

export function validateAlphaCleanup(report) {
  const reasons = [];
  const resources = report?.resources;
  const before = resources?.mediaBeforeDispose;
  const after = resources?.mediaAfterDispose;
  const runtimeBefore = resources?.sessionRuntimeBeforeDispose;
  const runtimeAfter = resources?.sessionRuntimeAfterDispose;
  if (resources?.sessionStateBeforeDispose !== 'ready') {
    reasons.push('Session must be ready before disposal');
  }
  if (resources?.sessionStateAfterDispose !== 'disposed') {
    reasons.push('Session must be disposed after cleanup');
  }
  if (resources?.opfsOutputRemoved !== true) reasons.push('OPFS output must be removed');
  if (resources?.providerDrained !== true) {
    reasons.push('Alpha runner did not certify providerDrained');
  }
  if (runtimeBefore?.activeExportJobId !== null) {
    reasons.push('Session export job must be settled before disposal');
  }
  if (runtimeBefore?.renderer?.pendingFrames !== 0) {
    reasons.push('Renderer frames must be idle before disposal');
  }
  if (
    runtimeBefore?.renderer?.rendererPresent !== true ||
    runtimeBefore?.renderer?.rendererDisposed !== false
  ) {
    reasons.push('Alpha must exercise one live Renderer before disposal');
  }
  if (runtimeBefore?.renderer?.workerPendingRequests !== 0) {
    reasons.push('Renderer Worker admission must be idle before disposal');
  }
  if (
    runtimeBefore?.renderer?.maxPendingFrames !== 2 ||
    !positiveSafeIntegerValue(runtimeBefore?.renderer?.requestedFrames) ||
    runtimeBefore.renderer.renderedFrames !== runtimeBefore.renderer.requestedFrames ||
    runtimeBefore.renderer.failedFrames !== 0 ||
    runtimeBefore.renderer.lastBackend !== 'webgl2' ||
    runtimeBefore.renderer.workerActiveRequests !== 0 ||
    runtimeBefore.renderer.workerCancelledRequests !== 0
  ) {
    reasons.push('Alpha live Renderer workload or configured queue bound differs');
  }
  const afterRenderer = runtimeAfter?.renderer;
  if (
    afterRenderer?.rendererPresent !== false ||
    afterRenderer?.rendererDisposed !== true ||
    afterRenderer?.pendingFrames !== 0 ||
    afterRenderer?.workerPendingRequests !== 0 ||
    afterRenderer?.workerActiveRequests !== 0 ||
    afterRenderer?.workerCancelledRequests !== 0
  ) {
    reasons.push('Renderer and Worker resources must be disposed and drained');
  }
  if (
    afterRenderer?.lastDisposedRenderer?.disposed !== true ||
    afterRenderer?.lastDisposedRenderer?.pendingFrames !== 0 ||
    afterRenderer?.lastDisposedRenderer?.workerDisposed !== true ||
    afterRenderer?.lastDisposedRenderer?.workerPendingRequests !== 0 ||
    afterRenderer?.lastDisposedRenderer?.workerActiveRequests !== 0 ||
    afterRenderer?.lastDisposedRenderer?.workerCancelledRequests !== 0
  ) {
    reasons.push('Renderer terminal snapshot must prove Worker termination and zero admission');
  }
  const afterPlayer = runtimeAfter?.player;
  const beforePlayer = runtimeBefore?.player;
  if (
    beforePlayer?.scheduler?.present !== true ||
    beforePlayer?.scheduler?.disposed !== false ||
    !['shared-ring', 'transferable-queue'].includes(beforePlayer?.audio?.mode) ||
    beforePlayer?.audio?.disposed !== false ||
    beforePlayer?.audio?.closed !== false ||
    beforePlayer?.listeners !== 1 ||
    beforePlayer?.runtimeInitializing !== false ||
    beforePlayer?.audioFillInFlight !== false ||
    !positiveSafeIntegerValue(beforePlayer?.audio?.bufferedFrames) ||
    beforePlayer.audio.bufferedFrames > 96_000
  ) {
    reasons.push('Alpha must exercise live Player scheduler and AudioWorklet resources');
  }
  if (
    afterPlayer?.listeners !== 0 ||
    afterPlayer?.runtimeInitializing !== false ||
    afterPlayer?.audioFillScheduled !== false ||
    afterPlayer?.audioFillInFlight !== false ||
    afterPlayer?.scheduler?.present !== false ||
    afterPlayer?.scheduler?.disposed !== true ||
    afterPlayer?.scheduler?.scheduled !== false ||
    afterPlayer?.scheduler?.rendering !== false ||
    afterPlayer?.audio?.mode !== 'none' ||
    afterPlayer?.audio?.disposed !== true ||
    afterPlayer?.audio?.contextState !== null ||
    afterPlayer?.audio?.bufferedFrames !== 0 ||
    afterPlayer?.audio?.closed !== true
  ) {
    reasons.push('Player scheduler, fill and AudioWorklet resources must be disposed and drained');
  }
  if (
    afterPlayer?.lastDisposedRuntime?.schedulerDisposed !== true ||
    afterPlayer?.lastDisposedRuntime?.audioDisposed !== true ||
    afterPlayer?.lastDisposedRuntime?.audioContextClosed !== true ||
    afterPlayer?.lastDisposedRuntime?.transportClosed !== true ||
    afterPlayer?.lastDisposedRuntime?.bufferedFrames !== 0
  ) {
    reasons.push('Player terminal snapshot must prove scheduler/audio/transport cleanup');
  }
  for (const field of ALPHA_IDLE_BEFORE_DISPOSE_FIELDS) {
    if (before?.[field] !== 0) reasons.push(`mediaBeforeDispose.${field} must be zero`);
  }
  if (
    before?.assets !== 3 ||
    !finiteNonNegative(before?.cachedBytes) ||
    before.cachedBytes > before?.maxCachedBytes ||
    before?.maxCachedBytes !== 16 * 1_024 * 1_024 ||
    before?.maxInFlightRequests !== 68 ||
    before?.maxConcurrentOperations !== 4 ||
    before?.maxPendingOperations !== 64 ||
    before?.maxConcurrentLoads !== 4
  ) {
    reasons.push('Alpha media cache/admission configured bounds differ or were exceeded');
  }
  for (const field of ALPHA_ZERO_RESOURCE_FIELDS) {
    if (after?.[field] !== 0) reasons.push(`mediaAfterDispose.${field} must be zero`);
  }
  if (report?.sink?.closed !== true || report?.sink?.aborted !== false) {
    reasons.push('Alpha sink must be closed successfully before cleanup');
  }
  if (report?.queues?.sinkMaxInFlightWrites !== 1) {
    reasons.push('Alpha sink queue must have one maximum in-flight write');
  }
  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      sessionStateBeforeDispose: resources?.sessionStateBeforeDispose ?? null,
      sessionStateAfterDispose: resources?.sessionStateAfterDispose ?? null,
      mediaBeforeDispose: before ?? null,
      mediaAfterDispose: after ?? null,
      sessionRuntimeBeforeDispose: runtimeBefore ?? null,
      sessionRuntimeAfterDispose: runtimeAfter ?? null,
      opfsOutputRemoved: resources?.opfsOutputRemoved ?? null,
      sinkClosed: report?.sink?.closed ?? null,
      sinkAborted: report?.sink?.aborted ?? null,
    },
  };
}

export function validateAlphaEvidence(report) {
  const reasons = [];
  if (report?.evidenceVersion !== '1.0.0') reasons.push('Alpha evidenceVersion must be 1.0.0');
  if (report?.command !== 'corepack pnpm report:alpha') reasons.push('Alpha command differs');
  if (!validTimestamp(report?.generatedAt))
    reasons.push('Alpha generatedAt must be an ISO timestamp');
  validateReferenceDevice(report, 'Alpha', reasons);
  if (report?.fixture !== 'examples/aelion-alpha-60s.project.json') {
    reasons.push('Alpha fixture differs');
  }
  if (report?.durationUs !== 60_000_000) reasons.push('Alpha duration differs');
  if (report?.projectId !== 'prj_alpha_60s') reasons.push('Alpha projectId differs');
  if (
    stableJson(report?.revisions) !==
    stableJson({ initial: '0', edited: '1', undo: '2', redo: '3' })
  ) {
    reasons.push('Alpha edit/undo/redo revision sequence differs');
  }
  if (report?.history?.canUndo !== true || report?.history?.canRedo !== false) {
    reasons.push('Alpha history state differs after redo');
  }
  const player = report?.player;
  if (
    player?.state !== 'paused' ||
    !positiveSafeIntegerValue(player?.emittedFrames) ||
    !Number.isSafeInteger(player?.firstTimestampUs) ||
    !Number.isSafeInteger(player?.lastTimestampUs) ||
    !Number.isSafeInteger(player?.currentTimeUs) ||
    player.firstTimestampUs !== 29_500_000 ||
    player.lastTimestampUs < player.firstTimestampUs ||
    player.lastTimestampUs > player.currentTimeUs ||
    player.currentTimeUs < 29_500_000 ||
    player.currentTimeUs > 31_000_000
  ) {
    reasons.push('Alpha seek/play/pause player evidence is invalid or inconsistent');
  }
  if (
    report?.preview?.width !== 320 ||
    report?.preview?.height !== 180 ||
    report?.preview?.backend !== 'webgl2' ||
    !exactStringSet(report?.preview?.materialIds, ['mat_warm', 'mat_dissolve'])
  ) {
    reasons.push('Alpha preview backend/material contract differs');
  }
  if (
    report?.export?.videoFrames !== 1_800 ||
    report?.export?.audioFrames !== 2_880_000 ||
    report?.export?.durationUs !== 60_000_000 ||
    report?.export?.mimeType !== 'video/webm; codecs="vp09.00.10.08, opus"'
  ) {
    reasons.push('Alpha export format/frame/duration contract differs');
  }
  const readback = report?.readback;
  if (
    readback?.container !== 'webm' ||
    readback?.durationUs !== 60_000_000 ||
    readback?.videoCodec !== 'vp9' ||
    readback?.audioCodec !== 'opus' ||
    readback?.videoSamples !== 1_800 ||
    readback?.audioSamples !== 3_001
  ) {
    reasons.push('Alpha container/codec/readback sample contract differs');
  }
  if (
    !Number.isSafeInteger(readback?.videoEndUs) ||
    !Number.isSafeInteger(readback?.audioEndUs) ||
    !Number.isSafeInteger(readback?.avEndDriftUs) ||
    readback.videoEndUs < 0 ||
    readback.audioEndUs < 0 ||
    readback.avEndDriftUs !== readback.videoEndUs - readback.audioEndUs ||
    Math.abs(readback.avEndDriftUs) > 1_000
  ) {
    reasons.push('Alpha A/V end timestamps are invalid, inconsistent or exceed 1,000 us drift');
  }
  if (report?.mainThread?.longTasksOver50Ms !== 0) {
    reasons.push('Alpha observed a >50 ms main-thread Long Task');
  }
  if (report?.mainThread?.maxLongTaskMs !== 0) {
    reasons.push('Alpha maximum Long Task differs from the zero-task count');
  }
  const progress = Array.isArray(report?.progress) ? report.progress : [];
  if (
    progress.length < 2 ||
    !approximatelyEqual(progress.at(-1), 1) ||
    progress.some(
      (value, index) =>
        !finiteNonNegative(value) || value > 1 || (index > 0 && value <= progress[index - 1]),
    )
  ) {
    reasons.push('Alpha export progress is missing, non-monotonic or incomplete');
  }
  const sessionEvents = Array.isArray(report?.publicApi?.sessionEvents)
    ? report.publicApi.sessionEvents
    : [];
  const leadingEvents = [
    'state-changed',
    'project-loaded',
    'project-changed',
    'project-changed',
    'project-changed',
  ];
  if (
    report?.publicApi?.usedFacadeOnly !== true ||
    sessionEvents.length < leadingEvents.length ||
    stableJson(sessionEvents.slice(0, leadingEvents.length)) !== stableJson(leadingEvents) ||
    sessionEvents.slice(leadingEvents.length).some(value => value !== 'stats-changed')
  ) {
    reasons.push('Alpha public facade/session event contract differs');
  }
  if (!finiteNonNegative(report?.elapsedMs) || report.elapsedMs <= 0) {
    reasons.push('Alpha elapsedMs is invalid');
  }
  for (const [name, snapshot] of [
    ['before', report?.memory?.before],
    ['beforeDispose', report?.memory?.beforeDispose],
  ]) {
    if (
      !finiteNonNegative(snapshot?.usedJsHeapBytes) ||
      !finiteNonNegative(snapshot?.totalJsHeapBytes) ||
      snapshot.usedJsHeapBytes > snapshot.totalJsHeapBytes ||
      snapshot.totalJsHeapBytes > 256 * 1_024 * 1_024
    ) {
      reasons.push(`Alpha ${name} heap snapshot is invalid or exceeds the 256 MiB budget`);
    }
  }
  if (
    finiteNonNegative(report?.memory?.before?.usedJsHeapBytes) &&
    finiteNonNegative(report?.memory?.beforeDispose?.usedJsHeapBytes) &&
    report.memory.beforeDispose.usedJsHeapBytes - report.memory.before.usedJsHeapBytes >
      64 * 1_024 * 1_024
  ) {
    reasons.push('Alpha live heap growth exceeds the 64 MiB evidence budget');
  }
  if (!isSha256(report?.artifact?.sha256)) reasons.push('Alpha artifact SHA-256 is invalid');
  if (
    report?.artifact?.file !== 'reports/baseline/alpha-60s.webm' ||
    !positiveSafeIntegerValue(report?.artifact?.bytes)
  ) {
    reasons.push('Alpha artifact file/byte contract differs');
  }
  if (
    !nonEmptyString(report?.sink?.fileName) ||
    !report.sink.fileName.endsWith('.webm') ||
    !positiveSafeIntegerValue(report?.sink?.writes) ||
    !positiveSafeIntegerValue(report?.sink?.bytesWritten) ||
    report.sink.bytesWritten < report.artifact?.bytes
  ) {
    reasons.push('Alpha sink byte/write statistics are invalid or inconsistent with the artifact');
  }
  const externalReadback = report?.externalReadback;
  if (
    !nonEmptyString(externalReadback?.implementation) ||
    !/^ffmpeg version \S+/u.test(externalReadback.implementation) ||
    externalReadback?.videoDecode !== 'passed' ||
    externalReadback?.audioDecode !== 'passed' ||
    !isSha256(externalReadback?.videoFrameMd5DocumentSha256) ||
    externalReadback.videoFrameMd5DocumentSha256 === sha256('') ||
    !/^MD5=[0-9a-f]{32}$/u.test(externalReadback?.audioPcmMd5 ?? '') ||
    externalReadback.audioPcmMd5 === 'MD5=d41d8cd98f00b204e9800998ecf8427e'
  ) {
    reasons.push('Alpha external FFmpeg video/audio readback identity or hashes are invalid');
  }
  const cleanup = validateAlphaCleanup(report);
  if (!cleanup.passed) reasons.push(...cleanup.reasons);
  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      durationUs: report?.durationUs ?? null,
      videoFrames: report?.export?.videoFrames ?? null,
      audioFrames: report?.export?.audioFrames ?? null,
      cleanup: cleanup.details,
    },
  };
}

export function validateBlockerReview(review, identity, options = {}) {
  const requireApproved = options.requireApproved ?? true;
  const requiredGateRun = options.gateRun;
  const reasons = [];
  if (review?.schemaVersion !== '3.0.0') reasons.push('schemaVersion must be 3.0.0');
  if (review?.evidenceKind !== 'aelion-phase-1-blocker-review') {
    reasons.push('evidenceKind must be aelion-phase-1-blocker-review');
  }
  if (!validTimestamp(review?.generatedAt)) reasons.push('generatedAt must be an ISO timestamp');
  if (!['not-approved', 'approved'].includes(review?.decision)) {
    reasons.push('decision must be not-approved or approved');
  }
  if (review?.reviewedAt !== null && !validTimestamp(review?.reviewedAt)) {
    reasons.push('reviewedAt must be null or an ISO timestamp');
  }

  const gateRun = review?.gateRun;
  if (gateRun === null || typeof gateRun !== 'object' || Array.isArray(gateRun)) {
    reasons.push('gateRun must be an object');
  } else {
    if (!isSha256(gateRun.resultsSha256)) reasons.push('gateRun.resultsSha256 is invalid');
    if (!validTimestamp(gateRun.startedAt))
      reasons.push('gateRun.startedAt must be an ISO timestamp');
    if (!validTimestamp(gateRun.endedAt)) reasons.push('gateRun.endedAt must be an ISO timestamp');
    if (
      validTimestamp(gateRun.startedAt) &&
      validTimestamp(gateRun.endedAt) &&
      Date.parse(gateRun.endedAt) < Date.parse(gateRun.startedAt)
    ) {
      reasons.push('gateRun.endedAt precedes gateRun.startedAt');
    }
    if (!isSha256(gateRun.sourceManifestSha256)) {
      reasons.push('gateRun.sourceManifestSha256 is invalid');
    }
    const artifacts = gateRun.artifacts;
    if (artifacts === null || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
      reasons.push('gateRun.artifacts must be an object');
    } else {
      const files = Array.isArray(artifacts.files) ? artifacts.files : [];
      if (!Array.isArray(artifacts.files)) reasons.push('gateRun.artifacts.files must be an array');
      const paths = [];
      for (const entry of files) {
        if (!nonEmptyString(entry?.file)) reasons.push('every reviewed artifact requires a file');
        else paths.push(entry.file);
        if (!Number.isSafeInteger(entry?.bytes) || entry.bytes <= 0) {
          reasons.push(`reviewed artifact ${String(entry?.file)} has invalid bytes`);
        }
        if (!isSha256(entry?.sha256)) {
          reasons.push(`reviewed artifact ${String(entry?.file)} has invalid sha256`);
        }
        if (!validTimestamp(entry?.mtime)) {
          reasons.push(`reviewed artifact ${String(entry?.file)} has invalid mtime`);
        }
      }
      if (new Set(paths).size !== paths.length) {
        reasons.push('reviewed artifact files must be unique');
      }
      if (!isSha256(artifacts.setSha256)) {
        reasons.push('gateRun.artifacts.setSha256 is invalid');
      } else if (artifacts.setSha256 !== sha256(stableJson(files))) {
        reasons.push('gateRun.artifacts.setSha256 differs from its file records');
      }
    }
  }
  if (
    review?.sourceIdentity === null ||
    typeof review?.sourceIdentity !== 'object' ||
    Array.isArray(review?.sourceIdentity)
  ) {
    reasons.push('sourceIdentity must be an object');
  } else {
    if (review.sourceIdentity.policyVersion !== WORKSPACE_IDENTITY_POLICY.version) {
      reasons.push('blocker review identity policyVersion differs');
    }
    if (
      review.sourceIdentity.manifestSha256 !== null &&
      !isSha256(review.sourceIdentity.manifestSha256)
    ) {
      reasons.push('blocker review manifestSha256 is invalid');
    }
  }

  const reviewers = Array.isArray(review?.reviewers) ? review.reviewers : [];
  if (reviewers.some(reviewer => !nonEmptyString(reviewer))) {
    reasons.push('reviewers must contain only non-empty strings');
  }
  const checks = review?.checks;
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    reasons.push('checks must be an object');
  } else {
    const names = Object.keys(checks);
    if (!exactStringSet(names, PHASE_1_BLOCKER_REVIEW_CHECKS)) {
      reasons.push('checks do not match the required blocker-review categories');
    }
    for (const name of PHASE_1_BLOCKER_REVIEW_CHECKS) {
      if (typeof checks[name] !== 'boolean') reasons.push(`checks.${name} must be boolean`);
    }
  }

  const blockers = Array.isArray(review?.blockers) ? review.blockers : [];
  if (!Array.isArray(review?.blockers)) reasons.push('blockers must be an array');
  const blockerIds = [];
  for (const blocker of blockers) {
    if (!nonEmptyString(blocker?.id)) reasons.push('every blocker requires an id');
    else blockerIds.push(blocker.id);
    if (!['open', 'resolved'].includes(blocker?.status)) {
      reasons.push(`blocker ${String(blocker?.id)} has an invalid status`);
    }
    if (!['release-blocker', 'critical', 'high'].includes(blocker?.severity)) {
      reasons.push(`blocker ${String(blocker?.id)} has an invalid severity`);
    }
    if (!nonEmptyString(blocker?.summary)) {
      reasons.push(`blocker ${String(blocker?.id)} requires a summary`);
    }
    if (
      !Array.isArray(blocker?.evidence) ||
      blocker.evidence.some(value => !nonEmptyString(value))
    ) {
      reasons.push(`blocker ${String(blocker?.id)} evidence must be a string array`);
    }
  }
  if (new Set(blockerIds).size !== blockerIds.length) reasons.push('blocker ids must be unique');
  const openBlockers = blockers.filter(blocker => blocker?.status === 'open');

  if (requireApproved) {
    if (review?.decision !== 'approved') reasons.push('blocker review decision is not approved');
    if (!validTimestamp(review?.reviewedAt)) reasons.push('approved review requires reviewedAt');
    if (reviewers.length === 0) reasons.push('approved review requires at least one reviewer');
    if (PHASE_1_BLOCKER_REVIEW_CHECKS.some(name => checks?.[name] !== true)) {
      reasons.push('approved review requires every check to be true');
    }
    if (openBlockers.length > 0) reasons.push('approved review cannot contain open blockers');
    if (review?.sourceIdentity?.manifestSha256 !== identity?.manifestSha256) {
      reasons.push('blocker review is not bound to the gate source identity');
    }
    if (
      requiredGateRun === null ||
      typeof requiredGateRun !== 'object' ||
      Array.isArray(requiredGateRun)
    ) {
      reasons.push('approved review validation requires the exact gate run binding');
    } else {
      if (stableJson(gateRun) !== stableJson(requiredGateRun)) {
        reasons.push('blocker review is not bound to the exact gate run and artifact set');
      }
      const gateEndedAt = Date.parse(requiredGateRun.endedAt);
      if (!validTimestamp(review?.generatedAt) || Date.parse(review.generatedAt) < gateEndedAt) {
        reasons.push('blocker review template predates the bound gate run completion');
      }
      if (!validTimestamp(review?.reviewedAt) || Date.parse(review.reviewedAt) < gateEndedAt) {
        reasons.push('blocker review approval predates the bound gate run completion');
      }
      if (
        validTimestamp(review?.generatedAt) &&
        validTimestamp(review?.reviewedAt) &&
        Date.parse(review.reviewedAt) < Date.parse(review.generatedAt)
      ) {
        reasons.push('blocker review approval predates its template generation');
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      decision: review?.decision ?? null,
      reviewedAt: review?.reviewedAt ?? null,
      reviewers,
      sourceManifestSha256: review?.sourceIdentity?.manifestSha256 ?? null,
      requiredManifestSha256: identity?.manifestSha256 ?? null,
      gateRun: gateRun ?? null,
      requiredGateRun: requiredGateRun ?? null,
      checks: checks ?? null,
      blockerCount: blockers.length,
      openBlockerIds: openBlockers.map(blocker => blocker.id),
    },
  };
}
