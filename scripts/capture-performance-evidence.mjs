#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import {
  captureBrowserIdentity,
  probeReferenceDevice,
  publishValidatedJson,
} from './evidence-runtime.mjs';
import { ffmpegCommand } from './ffmpeg-command.mjs';
import { validatePerformanceEvidence } from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'reports', 'baseline', 'performance-1080p30-chromium.json');
const server = await createServer({
  configFile: resolve(root, 'apps', 'evidence-runner', 'vite.config.ts'),
});

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited with ${String(code)}\n${stderr}`));
    });
  });
}

let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4176/apps/evidence-runner/performance.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      Reflect.has(globalThis, '__AELION_PERFORMANCE_EVIDENCE__') ||
      Reflect.has(globalThis, '__AELION_PERFORMANCE_ERROR__'),
    undefined,
    { timeout: 10 * 60_000 },
  );
  const failure = await page.evaluate(() =>
    Reflect.get(globalThis, '__AELION_PERFORMANCE_ERROR__'),
  );
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
  const evidence = await page.evaluate(() =>
    Reflect.get(globalThis, '__AELION_PERFORMANCE_EVIDENCE__'),
  );
  const mp4Bytes = Uint8Array.from(
    await page.evaluate(() =>
      Array.from(Reflect.get(globalThis, '__AELION_PERFORMANCE_MP4_READBACK__') ?? []),
    ),
  );
  if (mp4Bytes.byteLength === 0) throw new Error('1080p MP4 readback artifact was not captured');
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'aelion-performance-'));
  let externalMp4Readback;
  try {
    const mp4Path = join(temporaryDirectory, 'session-1080p.mp4');
    await writeFile(mp4Path, mp4Bytes);
    const [version, video, audio] = await Promise.all([
      run(ffmpegCommand, ['-version']),
      run(ffmpegCommand, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        mp4Path,
        '-map',
        '0:v:0',
        '-f',
        'framemd5',
        '-',
      ]),
      run(ffmpegCommand, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        mp4Path,
        '-map',
        '0:a:0',
        '-f',
        'md5',
        '-',
      ]),
    ]);
    const decodedFrames = video.stdout
      .split(/\r?\n/u)
      .filter(line => line.length > 0 && !line.startsWith('#')).length;
    if (decodedFrames !== 30) {
      throw new Error(`FFmpeg decoded ${decodedFrames.toString()} MP4 frames instead of 30`);
    }
    if (!/^MD5=[0-9a-f]{32}\s*$/u.test(audio.stdout)) {
      throw new Error('FFmpeg MP4 audio readback did not produce a PCM MD5');
    }
    externalMp4Readback = {
      implementation: version.stdout.split('\n')[0]?.trim() ?? 'ffmpeg',
      bytes: mp4Bytes.byteLength,
      videoDecode: 'passed',
      audioDecode: 'passed',
      videoFrames: decodedFrames,
      videoFrameMd5DocumentSha256: createHash('sha256').update(video.stdout).digest('hex'),
      audioPcmMd5: audio.stdout.trim(),
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  const [referenceDevice, browserIdentity] = await Promise.all([
    probeReferenceDevice(),
    captureBrowserIdentity(browser, page),
  ]);
  const report = {
    ...evidence,
    command: 'corepack pnpm report:performance',
    generatedAt: new Date().toISOString(),
    referenceDevice: {
      ...referenceDevice,
      ...browserIdentity,
    },
    browserVersion: browserIdentity.browserVersion,
    userAgent: browserIdentity.userAgent,
    externalMp4Readback,
  };
  if (process.env.AELION_PERFORMANCE_RAW_PATH) {
    await writeFile(
      resolve(root, process.env.AELION_PERFORMANCE_RAW_PATH),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  await publishValidatedJson({
    outputPath,
    document: report,
    validate: validatePerformanceEvidence,
  });
  console.log('Wrote ' + outputPath);
} finally {
  await browser?.close();
  await server.close();
}
