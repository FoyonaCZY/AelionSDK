#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import {
  captureBrowserIdentity,
  probeReferenceDevice,
  publishValidatedMediaReport,
} from './evidence-runtime.mjs';
import { validateAlphaEvidence } from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'reports', 'baseline');
const mediaPath = resolve(outputDirectory, 'alpha-60s.webm');
const reportPath = resolve(outputDirectory, 'alpha-60s.json');

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

function validateVideoFrameMd5(document, expectedFrames) {
  const lines = document.split(/\r?\n/u);
  if (!lines.includes('#media_type 0: video') || !lines.includes('#codec_id 0: rawvideo')) {
    throw new Error('FFmpeg video framemd5 header does not describe decoded raw video');
  }
  const frames = lines.filter(line => line.length > 0 && !line.startsWith('#'));
  if (frames.length !== expectedFrames) {
    throw new Error(
      `FFmpeg decoded ${frames.length.toString()} video frames; expected ${expectedFrames.toString()}`,
    );
  }
  frames.forEach((line, index) => {
    const fields = line.split(',').map(value => value.trim());
    if (
      fields.length !== 6 ||
      fields[0] !== '0' ||
      Number.parseInt(fields[2], 10) !== index ||
      !Number.isSafeInteger(Number.parseInt(fields[3], 10)) ||
      Number.parseInt(fields[3], 10) <= 0 ||
      !Number.isSafeInteger(Number.parseInt(fields[4], 10)) ||
      Number.parseInt(fields[4], 10) <= 0 ||
      !/^[0-9a-f]{32}$/u.test(fields[5])
    ) {
      throw new Error(`FFmpeg video framemd5 row ${index.toString()} is invalid`);
    }
  });
}

const server = await createServer({
  configFile: resolve(root, 'apps', 'evidence-runner', 'vite.config.ts'),
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4176/apps/evidence-runner/alpha.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      Reflect.has(globalThis, '__AELION_ALPHA_EVIDENCE__') ||
      Reflect.has(globalThis, '__AELION_ALPHA_ERROR__'),
    undefined,
    { timeout: 15 * 60_000 },
  );
  const failure = await page.evaluate(() => Reflect.get(globalThis, '__AELION_ALPHA_ERROR__'));
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
  const evidence = await page.evaluate(() => {
    const value = Reflect.get(globalThis, '__AELION_ALPHA_EVIDENCE__');
    return { bytes: Array.from(value.bytes), report: value.report };
  });
  const outputBytes = Uint8Array.from(evidence.bytes);
  const [referenceDevice, browserIdentity] = await Promise.all([
    probeReferenceDevice(),
    captureBrowserIdentity(browser, page),
  ]);
  await publishValidatedMediaReport({
    mediaPath,
    reportPath,
    artifactFile: 'reports/baseline/alpha-60s.webm',
    mediaBytes: outputBytes,
    buildReport: async ({ stagingMediaPath, bytes, sha256 }) => {
      const [ffmpegVersion, videoReadback, audioReadback] = await Promise.all([
        run('ffmpeg', ['-version']),
        run('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          stagingMediaPath,
          '-map',
          '0:v:0',
          '-f',
          'framemd5',
          '-',
        ]),
        run('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          stagingMediaPath,
          '-map',
          '0:a:0',
          '-f',
          'md5',
          '-',
        ]),
      ]);
      validateVideoFrameMd5(videoReadback.stdout, evidence.report.export.videoFrames);
      if (!/^MD5=[0-9a-f]{32}\s*$/u.test(audioReadback.stdout)) {
        throw new Error('FFmpeg audio PCM MD5 output is invalid');
      }
      return {
        ...evidence.report,
        command: 'corepack pnpm report:alpha',
        generatedAt: new Date().toISOString(),
        referenceDevice: {
          ...referenceDevice,
          ...browserIdentity,
        },
        browserVersion: browserIdentity.browserVersion,
        userAgent: browserIdentity.userAgent,
        artifact: {
          file: 'reports/baseline/alpha-60s.webm',
          bytes,
          sha256,
        },
        externalReadback: {
          implementation: ffmpegVersion.stdout.split('\n')[0]?.trim() ?? 'ffmpeg',
          videoDecode: 'passed',
          audioDecode: 'passed',
          videoFrameMd5DocumentSha256: createHash('sha256')
            .update(videoReadback.stdout)
            .digest('hex'),
          audioPcmMd5: audioReadback.stdout.trim(),
        },
      };
    },
    validateReport: validateAlphaEvidence,
  });
  process.stdout.write(`Wrote ${mediaPath} and ${reportPath}\n`);
} finally {
  await browser?.close();
  await server.close();
}
