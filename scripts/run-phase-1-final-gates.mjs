#!/usr/bin/env node

/**
 * Run the Phase 1 gates strictly in sequence and persist every result.
 *
 * Output is streamed to the terminal. After each command finishes, the result
 * file is atomically rewritten with its exact command, ISO start/end times,
 * exit code and a bounded output-tail summary. A failed gate does not prevent
 * later gates from running. Final blocker review and aggregation are a
 * separate post-run step bound to the same source identity.
 *
 *   node scripts/run-phase-1-final-gates.mjs
 *   node scripts/run-phase-1-final-gates.mjs --results /tmp/results.json
 */

import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PHASE_1_EVIDENCE_REFRESH_COMMANDS,
  PHASE_1_REQUIRED_GATE_COMMANDS,
  buildPhase1Postflight,
  collectPhase1RunArtifacts,
  sourceIdentitiesEqual,
  sourceIdentity,
} from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultResults = resolve(root, 'reports', 'baseline', 'phase-1-gate-results.json');
const lockPath = resolve(root, 'reports', 'baseline', 'phase-1-final-gates.lock');
const maximumSummaryCharacters = 12_000;

const gates = [
  ['corepack pnpm run ci', 'corepack', ['pnpm', 'run', 'ci']],
  ['corepack pnpm test:browser', 'corepack', ['pnpm', 'test:browser']],
  ['corepack pnpm test:browser:firefox', 'corepack', ['pnpm', 'test:browser:firefox']],
  ['corepack pnpm test:golden', 'corepack', ['pnpm', 'test:golden']],
  ['corepack pnpm bench', 'corepack', ['pnpm', 'bench']],
  ['corepack pnpm test:pack', 'corepack', ['pnpm', 'test:pack']],
  ['corepack pnpm test:consumer', 'corepack', ['pnpm', 'test:consumer']],
  ['corepack pnpm release:dry-run', 'corepack', ['pnpm', 'release:dry-run']],
  ['corepack pnpm format:check', 'corepack', ['pnpm', 'format:check']],
  ['corepack pnpm report:browser:chromium', 'corepack', ['pnpm', 'report:browser:chromium']],
  ['corepack pnpm report:browser:firefox', 'corepack', ['pnpm', 'report:browser:firefox']],
  ['corepack pnpm report:seek', 'corepack', ['pnpm', 'report:seek']],
  ['corepack pnpm report:performance', 'corepack', ['pnpm', 'report:performance']],
  ['corepack pnpm report:alpha', 'corepack', ['pnpm', 'report:alpha']],
];

const configuredCommands = gates.map(([command]) => command);
const expectedCommands = [...PHASE_1_REQUIRED_GATE_COMMANDS, ...PHASE_1_EVIDENCE_REFRESH_COMMANDS];
if (JSON.stringify(configuredCommands) !== JSON.stringify(expectedCommands)) {
  throw new Error('Phase 1 runner commands differ from the reviewed evidence policy');
}

function usage() {
  return `Usage: node scripts/run-phase-1-final-gates.mjs [options]

Options:
  --results <file>  Incremental command record path.
  --help            Show this help.
`;
}

function parseArguments(argv) {
  const options = { results: defaultResults };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (argument === '--results') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      options.results = resolve(root, value);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
  }
  return options;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function appendTail(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length <= maximumSummaryCharacters ? next : next.slice(-maximumSummaryCharacters);
}

function runGate([command, executable, args]) {
  return new Promise(resolvePromise => {
    const startedAt = new Date();
    process.stdout.write(`\n>>> ${command}\n>>> started ${startedAt.toISOString()}\n`);
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputTail = '';
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      outputTail = appendTail(outputTail, chunk.toString('utf8'));
    });
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      outputTail = appendTail(outputTail, chunk.toString('utf8'));
    });
    child.once('error', error => {
      outputTail = appendTail(outputTail, `\nspawn error: ${error.message}\n`);
    });
    child.once('close', (code, signal) => {
      const endedAt = new Date();
      const exitCode = code ?? 1;
      process.stdout.write(
        `\n<<< ${command}\n<<< ended ${endedAt.toISOString()} exit ${exitCode}\n`,
      );
      resolvePromise({
        command,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        exitCode,
        ...(signal === null ? {} : { signal }),
        summary: {
          status: exitCode === 0 ? 'passed' : 'failed',
          outputTail: outputTail.trim(),
          outputTailTruncated: outputTail.length === maximumSummaryCharacters,
        },
      });
    });
  });
}

const options = parseArguments(process.argv.slice(2));
await mkdir(dirname(lockPath), { recursive: true });
let lock;
try {
  lock = await open(lockPath, 'wx');
  await lock.writeFile(
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
  );
} catch (error) {
  throw new Error(
    `Another Phase 1 final gate run owns ${relative(root, lockPath)}; refusing concurrent evidence refresh`,
    { cause: error },
  );
}

const document = {
  schemaVersion: '3.0.0',
  generatedBy: 'scripts/run-phase-1-final-gates.mjs',
  startedAt: new Date().toISOString(),
  sourceIdentityBefore: null,
  commands: [],
};
try {
  try {
    document.sourceIdentityBefore = await sourceIdentity(root);
    await writeJsonAtomic(options.results, document);

    for (const gate of gates) {
      document.commands.push(await runGate(gate));
      document.updatedAt = new Date().toISOString();
      await writeJsonAtomic(options.results, document);
    }

    const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const postflightGeneratedAt = new Date().toISOString();
    try {
      document.postflight = buildPhase1Postflight(
        document.commands,
        await collectPhase1RunArtifacts(root),
        rootManifest.version,
        postflightGeneratedAt,
      );
    } catch (error) {
      document.postflight = buildPhase1Postflight(
        document.commands,
        [],
        rootManifest.version,
        postflightGeneratedAt,
      );
      document.postflight.internalError = error instanceof Error ? error.message : String(error);
    }
    try {
      document.sourceIdentityAfter = await sourceIdentity(root);
    } catch (error) {
      document.sourceIdentityAfter = null;
      document.sourceIdentityError = error instanceof Error ? error.message : String(error);
    }
    document.sourceIdentityMatches = sourceIdentitiesEqual(
      document.sourceIdentityBefore,
      document.sourceIdentityAfter,
    );
    document.endedAt = new Date().toISOString();
  } catch (error) {
    document.fatalError = error instanceof Error ? error.message : String(error);
    document.sourceIdentityMatches = false;
    document.endedAt = new Date().toISOString();
  }
  await writeJsonAtomic(options.results, document);

  if (!document.sourceIdentityMatches) {
    process.stderr.write('Phase 1 source identity was unavailable or changed during the run.\n');
  }
  const failed = document.commands.filter(command => command.exitCode !== 0);
  if (document.postflight?.passed !== true) {
    process.stderr.write(
      `Phase 1 artifact postflight failed: ${(document.postflight?.failedChecks ?? ['postflight-unavailable']).join(', ')}\n`,
    );
  }
  process.stdout.write(`Phase 1 gate records: ${relative(root, options.results)}\n`);
  if (
    failed.length > 0 ||
    !document.sourceIdentityMatches ||
    document.postflight?.passed !== true ||
    document.fatalError !== undefined
  ) {
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Next: update the post-gate status documents, run corepack pnpm report:phase1:blocker-template, complete the independent review bound to ${document.sourceIdentityAfter.manifestSha256}, then run corepack pnpm report:phase1:gates.\n`,
    );
  }
} finally {
  await lock.close();
  await unlink(lockPath).catch(() => undefined);
}
