import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import * as nodeOs from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as waitTimer } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const gibibyte = 1_073_741_824;
const pairLockTails = new Map();
const pairLockPollMs = 25;
const pairLockTimeoutMs = 120_000;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+/u);
  if (match === null) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function memoryGiB(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(GB|TB)$/iu);
  if (match === null) return null;
  const amount = Number.parseFloat(match[1]);
  const multiplier = match[2].toUpperCase() === 'TB' ? 1024 : 1;
  const result = Math.round(amount * multiplier);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function nodeFallback(osApi) {
  const platform = osApi.platform();
  const architecture = osApi.arch();
  const machine = typeof osApi.machine === 'function' ? osApi.machine() : architecture;
  const cpus = osApi.cpus();
  const logicalCpuCount = Math.max(
    1,
    cpus.length,
    typeof osApi.availableParallelism === 'function' ? osApi.availableParallelism() : 0,
  );
  const cpuModel = cpus.find(cpu => nonEmptyString(cpu?.model))?.model.trim();
  const memoryBytes = osApi.totalmem();
  const osName = nonEmptyString(osApi.type()) ? osApi.type().trim() : platform;
  const osVersion = nonEmptyString(osApi.release()) ? osApi.release().trim() : 'unknown';
  return {
    model: `${osName} ${machine}`,
    cpu: `${cpuModel ?? architecture}, ${logicalCpuCount.toString()} logical CPUs`,
    memoryGiB: Math.max(1, Math.round(memoryBytes / gibibyte)),
    os: `${osName} ${osVersion}`,
    platform,
    architecture,
    logicalCpuCount,
    physicalCoreCount: null,
    memoryBytes,
    osVersion,
    osBuild: null,
  };
}

/**
 * Extracts only the non-identifying hardware fields approved for evidence.
 * Raw system_profiler output must never be attached to the returned object.
 */
export function parseDarwinHardwareProfile(stdout) {
  const document = JSON.parse(stdout);
  const hardware = Array.isArray(document?.SPHardwareDataType)
    ? document.SPHardwareDataType[0]
    : undefined;
  if (hardware === null || typeof hardware !== 'object') {
    throw new Error('system_profiler did not return SPHardwareDataType');
  }
  const model = nonEmptyString(hardware.machine_model)
    ? hardware.machine_model.trim()
    : nonEmptyString(hardware.machine_name)
      ? hardware.machine_name.trim()
      : null;
  const cpuName = nonEmptyString(hardware.chip_type)
    ? hardware.chip_type.trim()
    : nonEmptyString(hardware.cpu_type)
      ? hardware.cpu_type.trim()
      : null;
  const cpuSpeed = nonEmptyString(hardware.current_processor_speed)
    ? hardware.current_processor_speed.trim()
    : null;
  return {
    model,
    cpu: cpuName === null ? null : [cpuName, cpuSpeed].filter(Boolean).join(' '),
    physicalCoreCount: positiveInteger(hardware.number_processors),
    memoryGiB: memoryGiB(hardware.physical_memory),
  };
}

/** Extracts the three public sw_vers fields used by evidence. */
export function parseSwVers(stdout) {
  const values = {};
  for (const line of stdout.split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (['ProductName', 'ProductVersion', 'BuildVersion'].includes(key) && value.length > 0) {
      values[key] = value;
    }
  }
  if (!nonEmptyString(values.ProductVersion)) throw new Error('sw_vers ProductVersion is missing');
  return {
    name: nonEmptyString(values.ProductName) ? values.ProductName : 'macOS',
    version: values.ProductVersion,
    build: nonEmptyString(values.BuildVersion) ? values.BuildVersion : null,
  };
}

async function commandOutput(command, args) {
  const result = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout;
}

/**
 * Captures a real, privacy-bounded reference-device description. It never
 * persists host names, serial numbers, UUIDs, UDIDs, or raw profiler output.
 */
export async function probeReferenceDevice(options = {}) {
  const osApi = options.osApi ?? nodeOs;
  const runCommand = options.runCommand ?? commandOutput;
  const fallback = nodeFallback(osApi);
  const sources = ['node:os'];
  const limitations = [];
  let result = fallback;

  if (fallback.platform === 'darwin') {
    try {
      const profile = parseDarwinHardwareProfile(
        await runCommand('system_profiler', ['SPHardwareDataType', '-json']),
      );
      result = {
        ...result,
        ...(profile.model === null ? {} : { model: profile.model }),
        ...(profile.cpu === null
          ? {}
          : { cpu: `${profile.cpu}, ${fallback.logicalCpuCount.toString()} logical CPUs` }),
        ...(profile.physicalCoreCount === null
          ? {}
          : { physicalCoreCount: profile.physicalCoreCount }),
        ...(profile.memoryGiB === null ? {} : { memoryGiB: profile.memoryGiB }),
      };
      sources.push('system_profiler');
      if (profile.physicalCoreCount === null) {
        limitations.push('system_profiler did not disclose a physical core count');
      }
    } catch {
      limitations.push(
        'system_profiler unavailable; model and physical cores use node:os fallback',
      );
    }

    try {
      const version = parseSwVers(await runCommand('sw_vers', []));
      result = {
        ...result,
        os: `${version.name} ${version.version}${version.build === null ? '' : ` (${version.build})`}`,
        osVersion: version.version,
        osBuild: version.build,
      };
      sources.push('sw_vers');
    } catch {
      limitations.push('sw_vers unavailable; OS version uses node:os fallback');
    }
  } else {
    limitations.push(
      'physical core count and hardware model are unavailable from portable node:os',
    );
  }

  return {
    ...result,
    probe: {
      source: sources.join('+'),
      limitations,
    },
  };
}

/** Captures and cross-checks Playwright's process version and page UA. */
export async function captureBrowserIdentity(browser, page, product = 'Google Chrome') {
  const browserVersion = browser.version().trim();
  const userAgent = (await page.evaluate(() => navigator.userAgent)).trim();
  const versionMatch = browserVersion.match(/^(\d+)(?:\.\d+){1,4}$/u);
  if (versionMatch === null) throw new Error(`Browser version is invalid: ${browserVersion}`);
  if (!nonEmptyString(userAgent)) throw new Error('Browser user agent is empty');
  const major = versionMatch[1];
  const uaVersion = new RegExp(`(?:Chrome|Chromium)/${major}(?:\\.|\\s|$)`, 'u');
  if (!uaVersion.test(userAgent)) {
    throw new Error('Browser process version and page user agent major versions differ');
  }
  return {
    browser: `${product} ${browserVersion}`,
    browserVersion,
    userAgent,
  };
}

function uniqueSibling(path, suffix) {
  return join(
    dirname(path),
    `.${basename(path)}.${process.pid.toString()}.${randomUUID()}.${suffix}`,
  );
}

async function writeStaged(path, contents) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function canonicalTargetPath(path) {
  return join(await realpath(dirname(path)), basename(path));
}

function wait(milliseconds) {
  return waitTimer(milliseconds);
}

async function acquireCrossProcessPairLock(lockPath, canonicalPaths) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeStaged(
          join(lockPath, 'owner.json'),
          `${JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
            targets: canonicalPaths,
          })}\n`,
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
        if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
          } catch (ownerError) {
            if (ownerError?.code === 'ESRCH') {
              const stalePath = `${lockPath}.${process.pid.toString()}.${randomUUID()}.stale`;
              await rename(lockPath, stalePath);
              await rm(stalePath, { recursive: true, force: true });
              continue;
            }
          }
        }
      } catch (ownerError) {
        if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(ownerError?.code)) {
          // A malformed owner record is fail-closed until the normal timeout.
        }
      }
      if (Date.now() - startedAt >= pairLockTimeoutMs) {
        throw new Error(`Timed out waiting for evidence pair lock ${lockPath}`, { cause: error });
      }
      await wait(pairLockPollMs);
    }
  }
}

async function withCanonicalPairLock(mediaPath, reportPath, operation) {
  const canonicalPaths = await Promise.all([
    canonicalTargetPath(mediaPath),
    canonicalTargetPath(reportPath),
  ]).then(paths => paths.sort());
  if (canonicalPaths[0] === canonicalPaths[1]) {
    throw new Error('Alpha media and report paths must name distinct files');
  }
  const key = createHash('sha256').update(canonicalPaths.join('\0')).digest('hex');
  const lockPath = join(dirname(canonicalPaths[0]), `.aelion-evidence-pair-${key}.lock`);

  const previous = pairLockTails.get(key) ?? Promise.resolve();
  let releaseInProcess;
  const tail = new Promise(resolvePromise => {
    releaseInProcess = resolvePromise;
  });
  pairLockTails.set(key, tail);
  await previous;

  let releaseCrossProcess;
  try {
    releaseCrossProcess = await acquireCrossProcessPairLock(lockPath, canonicalPaths);
    return await operation();
  } finally {
    await releaseCrossProcess?.();
    releaseInProcess();
    if (pairLockTails.get(key) === tail) pairLockTails.delete(key);
  }
}

function assertValidation(validation, scope) {
  if (validation?.passed === true) return;
  const reasons = Array.isArray(validation?.reasons) ? validation.reasons.join('; ') : 'unknown';
  throw new Error(`${scope} evidence contract failed: ${reasons}`);
}

/** Validates the bytes staged on disk before atomically replacing one JSON artifact. */
export async function publishValidatedJson({ outputPath, document, validate }) {
  await mkdir(dirname(outputPath), { recursive: true });
  const stagingPath = uniqueSibling(outputPath, 'stage');
  let published = false;
  try {
    assertValidation(await validate(document), 'JSON');
    await writeStaged(stagingPath, `${JSON.stringify(document, null, 2)}\n`);
    const stagedDocument = JSON.parse(await readFile(stagingPath, 'utf8'));
    const validation = await validate(stagedDocument);
    assertValidation(validation, 'JSON');
    await rename(stagingPath, outputPath);
    published = true;
    return { document: stagedDocument, validation };
  } finally {
    if (!published) await rm(stagingPath, { force: true });
  }
}

async function inspectMedia(path) {
  const bytes = await readFile(path);
  const metadata = await stat(path);
  return {
    bytes: metadata.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assertMediaBinding(report, media, artifactFile) {
  if (
    report?.artifact?.file !== artifactFile ||
    report?.artifact?.bytes !== media.bytes ||
    report?.artifact?.sha256 !== media.sha256
  ) {
    throw new Error('Alpha report artifact does not match the staged media bytes');
  }
}

async function backupIfPresent(path, backupPath) {
  try {
    await rename(path, backupPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function restorePair(state) {
  const failures = [];
  for (const [published, path] of [
    [state.reportPublished, state.reportPath],
    [state.mediaPublished, state.mediaPath],
  ]) {
    if (!published) continue;
    try {
      await rm(path, { force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  for (const [backedUp, backupPath, path] of [
    [state.mediaBackedUp, state.mediaBackupPath, state.mediaPath],
    [state.reportBackedUp, state.reportBackupPath, state.reportPath],
  ]) {
    if (!backedUp) continue;
    try {
      await rename(backupPath, path);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Alpha evidence rollback failed');
}

/**
 * Stages, reads back, validates, and transactionally publishes Alpha media and
 * its JSON report. Any publish failure restores the previous pair.
 */
export async function publishValidatedMediaReport({
  mediaPath,
  reportPath,
  artifactFile,
  mediaBytes,
  buildReport,
  validateReport,
  testHooks = {},
}) {
  await Promise.all([
    mkdir(dirname(mediaPath), { recursive: true }),
    mkdir(dirname(reportPath), { recursive: true }),
  ]);
  return withCanonicalPairLock(mediaPath, reportPath, async () => {
    const mediaStagingPath = uniqueSibling(mediaPath, 'stage');
    const reportStagingPath = uniqueSibling(reportPath, 'stage');
    const mediaBackupPath = uniqueSibling(mediaPath, 'backup');
    const reportBackupPath = uniqueSibling(reportPath, 'backup');
    const state = {
      mediaPath,
      reportPath,
      mediaBackupPath,
      reportBackupPath,
      mediaBackedUp: false,
      reportBackedUp: false,
      mediaPublished: false,
      reportPublished: false,
    };
    let committed = false;
    try {
      await writeStaged(mediaStagingPath, mediaBytes);
      const initialMedia = await inspectMedia(mediaStagingPath);
      const report = await buildReport({
        stagingMediaPath: mediaStagingPath,
        ...initialMedia,
      });
      assertMediaBinding(report, initialMedia, artifactFile);
      assertValidation(await validateReport(report), 'Alpha');
      await writeStaged(reportStagingPath, `${JSON.stringify(report, null, 2)}\n`);

      const stagedReport = JSON.parse(await readFile(reportStagingPath, 'utf8'));
      const finalMedia = await inspectMedia(mediaStagingPath);
      assertMediaBinding(stagedReport, finalMedia, artifactFile);
      assertValidation(await validateReport(stagedReport), 'Alpha');

      state.mediaBackedUp = await backupIfPresent(mediaPath, mediaBackupPath);
      state.reportBackedUp = await backupIfPresent(reportPath, reportBackupPath);
      await rename(mediaStagingPath, mediaPath);
      state.mediaPublished = true;
      await testHooks.beforeReportPublish?.();
      await rename(reportStagingPath, reportPath);
      state.reportPublished = true;
      await testHooks.afterReportPublish?.();

      const publishedReport = JSON.parse(await readFile(reportPath, 'utf8'));
      const publishedMedia = await inspectMedia(mediaPath);
      assertMediaBinding(publishedReport, publishedMedia, artifactFile);
      assertValidation(await validateReport(publishedReport), 'Alpha');
      committed = true;
      return publishedReport;
    } catch (error) {
      try {
        await restorePair(state);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Alpha evidence publish and rollback failed',
        );
      }
      throw error;
    } finally {
      await Promise.allSettled([
        rm(mediaStagingPath, { force: true }),
        rm(reportStagingPath, { force: true }),
        ...(committed
          ? [rm(mediaBackupPath, { force: true }), rm(reportBackupPath, { force: true })]
          : []),
      ]);
    }
  });
}
