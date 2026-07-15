import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { TextEncoder } from 'node:util';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';

import {
  captureBrowserIdentity,
  parseDarwinHardwareProfile,
  parseSwVers,
  probeReferenceDevice,
  publishValidatedJson,
  publishValidatedMediaReport,
} from './evidence-runtime.mjs';

function fakeOs(platform = 'darwin') {
  return {
    platform: () => platform,
    arch: () => 'arm64',
    machine: () => 'arm64',
    type: () => (platform === 'darwin' ? 'Darwin' : 'Linux'),
    release: () => 'fallback-release',
    totalmem: () => 16 * 1_073_741_824,
    availableParallelism: () => 10,
    cpus: () => Array.from({ length: 10 }, () => ({ model: 'Real Test CPU' })),
  };
}

test('Darwin parsers return only approved non-identifying fields', () => {
  const hardware = parseDarwinHardwareProfile(
    JSON.stringify({
      SPHardwareDataType: [
        {
          machine_model: 'MacBookPro18,2',
          machine_name: 'MacBook Pro',
          chip_type: 'Apple M1 Max',
          number_processors: 'proc 10:8 performance and 2 efficiency',
          physical_memory: '32 GB',
          serial_number: 'SECRET-SERIAL',
          platform_UUID: 'SECRET-UUID',
          provisioning_UDID: 'SECRET-UDID',
          boot_rom_version: 'SECRET-ROM',
        },
      ],
    }),
  );
  assert.deepEqual(hardware, {
    model: 'MacBookPro18,2',
    cpu: 'Apple M1 Max',
    physicalCoreCount: 10,
    memoryGiB: 32,
  });
  const serialized = JSON.stringify(hardware);
  for (const secret of ['SERIAL', 'UUID', 'UDID', 'ROM'])
    assert.doesNotMatch(serialized, new RegExp(secret));

  assert.deepEqual(
    parseSwVers('ProductName:\tmacOS\nProductVersion:\t15.6.1\nBuildVersion:\t24G90\n'),
    { name: 'macOS', version: '15.6.1', build: '24G90' },
  );
});

test('reference-device probe uses Darwin data and records explicit fallback limitations', async () => {
  const outputs = new Map([
    [
      'system_profiler',
      JSON.stringify({
        SPHardwareDataType: [
          {
            machine_model: 'MacBookPro18,2',
            chip_type: 'Apple M1 Max',
            number_processors: 10,
            physical_memory: '32 GB',
            serial_number: 'MUST-NOT-LEAK',
          },
        ],
      }),
    ],
    ['sw_vers', 'ProductName: macOS\nProductVersion: 15.6.1\nBuildVersion: 24G90\n'],
  ]);
  const probed = await probeReferenceDevice({
    osApi: fakeOs(),
    runCommand: command => Promise.resolve(outputs.get(command)),
  });
  assert.equal(probed.model, 'MacBookPro18,2');
  assert.equal(probed.physicalCoreCount, 10);
  assert.equal(probed.logicalCpuCount, 10);
  assert.equal(probed.memoryGiB, 32);
  assert.equal(probed.os, 'macOS 15.6.1 (24G90)');
  assert.equal(probed.probe.source, 'node:os+system_profiler+sw_vers');
  assert.deepEqual(probed.probe.limitations, []);
  assert.doesNotMatch(JSON.stringify(probed), /MUST-NOT-LEAK/u);

  const fallback = await probeReferenceDevice({
    osApi: fakeOs(),
    runCommand: () => Promise.reject(new Error('unavailable')),
  });
  assert.equal(fallback.probe.source, 'node:os');
  assert.equal(fallback.physicalCoreCount, null);
  assert.equal(fallback.probe.limitations.length, 2);
  assert.equal(fallback.model, 'Darwin arm64');
  assert.match(fallback.cpu, /Real Test CPU/u);
});

test('browser identity requires Playwright and page versions to agree', async () => {
  const identity = await captureBrowserIdentity(
    { version: () => '149.0.7827.201' },
    { evaluate: () => Promise.resolve('Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36') },
  );
  assert.deepEqual(identity, {
    browser: 'Google Chrome 149.0.7827.201',
    browserVersion: '149.0.7827.201',
    userAgent: 'Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36',
  });
  await assert.rejects(
    captureBrowserIdentity(
      { version: () => '149.0.7827.201' },
      { evaluate: () => Promise.resolve('Mozilla/5.0 Chrome/148.0.0.0') },
    ),
    /major versions differ/u,
  );
});

test('failed staged JSON validation preserves the published artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-evidence-json-'));
  const outputPath = join(directory, 'evidence.json');
  try {
    await writeFile(outputPath, '{"generation":"old"}\n');
    await assert.rejects(
      publishValidatedJson({
        outputPath,
        document: { generation: 'new' },
        validate: () => ({ passed: false, reasons: ['intentional failure'] }),
      }),
      /intentional failure/u,
    );
    assert.equal(await readFile(outputPath, 'utf8'), '{"generation":"old"}\n');
    assert.deepEqual(await readdir(directory), ['evidence.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Alpha pair publication restores both old artifacts when report publish fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-evidence-alpha-'));
  const mediaPath = join(directory, 'alpha.webm');
  const reportPath = join(directory, 'alpha.json');
  try {
    await writeFile(mediaPath, 'old-media');
    await writeFile(reportPath, '{"generation":"old"}\n');
    await assert.rejects(
      publishValidatedMediaReport({
        mediaPath,
        reportPath,
        artifactFile: 'reports/alpha.webm',
        mediaBytes: new TextEncoder().encode('new-media'),
        buildReport: ({ bytes, sha256 }) =>
          Promise.resolve({
            generation: 'new',
            artifact: { file: 'reports/alpha.webm', bytes, sha256 },
          }),
        validateReport: () => ({ passed: true, reasons: [] }),
        testHooks: {
          beforeReportPublish: () => Promise.reject(new Error('simulated report rename failure')),
        },
      }),
      /simulated report rename failure/u,
    );
    assert.equal(await readFile(mediaPath, 'utf8'), 'old-media');
    assert.equal(await readFile(reportPath, 'utf8'), '{"generation":"old"}\n');
    assert.deepEqual((await readdir(directory)).sort(), ['alpha.json', 'alpha.webm']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function publishGeneration({ mediaPath, reportPath, generation, media, testHooks = {} }) {
  return publishValidatedMediaReport({
    mediaPath,
    reportPath,
    artifactFile: 'reports/alpha.webm',
    mediaBytes: new TextEncoder().encode(media),
    buildReport: ({ bytes, sha256 }) =>
      Promise.resolve({
        generation,
        artifact: { file: 'reports/alpha.webm', bytes, sha256 },
      }),
    validateReport: () => ({ passed: true, reasons: [] }),
    testHooks,
  });
}

function runPublisherChild(environment) {
  const source = `
    import { writeFile } from 'node:fs/promises';
    import { publishValidatedMediaReport } from './scripts/evidence-runtime.mjs';
    await publishValidatedMediaReport({
      mediaPath: process.env.MEDIA_PATH,
      reportPath: process.env.REPORT_PATH,
      artifactFile: 'reports/alpha.webm',
      mediaBytes: new TextEncoder().encode(process.env.MEDIA),
      buildReport: async ({ bytes, sha256 }) => {
        if (process.env.BUILD_MARKER) await writeFile(process.env.BUILD_MARKER, 'entered');
        return { generation: process.env.GENERATION, artifact: { file: 'reports/alpha.webm', bytes, sha256 } };
      },
      validateReport: () => ({ passed: true, reasons: [] }),
      testHooks: process.env.PAUSE_MARKER ? {
        beforeReportPublish: async () => {
          await writeFile(process.env.PAUSE_MARKER, 'paused');
          while (true) {
            try { await writeFile(process.env.RELEASE_MARKER, '', { flag: 'r' }); break; }
            catch (error) {
              if (error?.code !== 'ENOENT') throw error;
              await new Promise(resolvePromise => globalThis.setTimeout(resolvePromise, 10));
            }
          }
        },
      } : {},
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', chunk => {
    output += chunk.toString('utf8');
  });
  return {
    child,
    completed: new Promise((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('close', code => {
        if (code === 0) resolvePromise();
        else reject(new Error(`publisher child exited ${String(code)}: ${output}`));
      });
    }),
  };
}

async function waitForFile(path) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await wait(10);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test('Alpha pair publication serializes canonical path aliases in one process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-evidence-alpha-race-'));
  const alias = join(`${directory}-alias`);
  const mediaPath = join(directory, 'alpha.webm');
  const reportPath = join(directory, 'alpha.json');
  let releaseFirst;
  const firstPaused = new Promise(resolvePromise => {
    releaseFirst = resolvePromise;
  });
  let markFirstPaused;
  const firstReachedPublish = new Promise(resolvePromise => {
    markFirstPaused = resolvePromise;
  });
  let secondEnteredBuild = false;
  try {
    await symlink(directory, alias);
    const first = publishGeneration({
      mediaPath,
      reportPath,
      generation: 'first',
      media: 'first-media',
      testHooks: {
        beforeReportPublish: async () => {
          markFirstPaused();
          await firstPaused;
        },
      },
    });
    await firstReachedPublish;
    const second = publishValidatedMediaReport({
      mediaPath: join(alias, 'alpha.webm'),
      reportPath: join(alias, 'alpha.json'),
      artifactFile: 'reports/alpha.webm',
      mediaBytes: new TextEncoder().encode('second-media'),
      buildReport: ({ bytes, sha256 }) => {
        secondEnteredBuild = true;
        return Promise.resolve({
          generation: 'second',
          artifact: { file: 'reports/alpha.webm', bytes, sha256 },
        });
      },
      validateReport: () => ({ passed: true, reasons: [] }),
    });
    await wait(50);
    assert.equal(secondEnteredBuild, false);
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(secondEnteredBuild, true);
    assert.equal(await readFile(mediaPath, 'utf8'), 'second-media');
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).generation, 'second');
    assert.deepEqual((await readdir(directory)).sort(), ['alpha.json', 'alpha.webm']);
  } finally {
    releaseFirst?.();
    await rm(alias, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('Alpha pair publication serializes the same canonical pair across processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-evidence-alpha-process-race-'));
  const mediaPath = join(directory, 'alpha.webm');
  const reportPath = join(directory, 'alpha.json');
  const pauseMarker = join(directory, 'first-paused');
  const releaseMarker = join(directory, 'release-first');
  const secondBuildMarker = join(directory, 'second-build');
  let first;
  let second;
  try {
    first = runPublisherChild({
      MEDIA_PATH: mediaPath,
      REPORT_PATH: reportPath,
      MEDIA: 'first-media',
      GENERATION: 'first',
      PAUSE_MARKER: pauseMarker,
      RELEASE_MARKER: releaseMarker,
    });
    await waitForFile(pauseMarker);
    second = runPublisherChild({
      MEDIA_PATH: mediaPath,
      REPORT_PATH: reportPath,
      MEDIA: 'second-media',
      GENERATION: 'second',
      BUILD_MARKER: secondBuildMarker,
    });
    await wait(100);
    await assert.rejects(readFile(secondBuildMarker), error => error?.code === 'ENOENT');
    await writeFile(releaseMarker, 'release');
    await Promise.all([first.completed, second.completed]);
    assert.equal(await readFile(mediaPath, 'utf8'), 'second-media');
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).generation, 'second');
  } finally {
    first?.child.kill('SIGKILL');
    second?.child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});

test('Alpha pair publication rolls back when published bytes fail readback binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-evidence-alpha-readback-'));
  const mediaPath = join(directory, 'alpha.webm');
  const reportPath = join(directory, 'alpha.json');
  try {
    await writeFile(mediaPath, 'old-media');
    await writeFile(reportPath, '{"generation":"old"}\n');
    await assert.rejects(
      publishGeneration({
        mediaPath,
        reportPath,
        generation: 'new',
        media: 'new-media',
        testHooks: {
          afterReportPublish: () => writeFile(mediaPath, 'tampered-after-publish'),
        },
      }),
      /does not match the staged media bytes/u,
    );
    assert.equal(await readFile(mediaPath, 'utf8'), 'old-media');
    assert.equal(await readFile(reportPath, 'utf8'), '{"generation":"old"}\n');
    assert.deepEqual((await readdir(directory)).sort(), ['alpha.json', 'alpha.webm']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
