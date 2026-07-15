#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'reports', 'baseline');
const mediaPath = resolve(outputDirectory, 'vertical-slice-30s.webm');
const reportPath = resolve(outputDirectory, 'vertical-slice-30s.json');

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
      else reject(new Error(command + ' exited with ' + String(code) + '\n' + stderr));
    });
  });
}

const server = await createServer({
  configFile: resolve(root, 'apps', 'evidence-runner', 'vite.config.ts'),
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4176/apps/evidence-runner/index.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      Reflect.has(globalThis, '__AELION_VERTICAL_EVIDENCE__') ||
      Reflect.has(globalThis, '__AELION_VERTICAL_ERROR__'),
    undefined,
    { timeout: 10 * 60_000 },
  );
  const failure = await page.evaluate(() => Reflect.get(globalThis, '__AELION_VERTICAL_ERROR__'));
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
  const evidence = await page.evaluate(() => {
    const value = Reflect.get(globalThis, '__AELION_VERTICAL_EVIDENCE__');
    return {
      bytes: Array.from(value.bytes),
      report: value.report,
    };
  });
  const outputBytes = Uint8Array.from(evidence.bytes);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(mediaPath, outputBytes);
  const [ffmpegVersion, videoReadback, audioReadback] = await Promise.all([
    run('ffmpeg', ['-version']),
    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      mediaPath,
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
      mediaPath,
      '-map',
      '0:a:0',
      '-f',
      'md5',
      '-',
    ]),
  ]);
  const report = {
    evidenceVersion: '1.0.0',
    command: 'pnpm report:vertical',
    generatedAt: new Date().toISOString(),
    ...evidence.report,
    artifact: {
      file: 'reports/baseline/vertical-slice-30s.webm',
      bytes: outputBytes.byteLength,
      sha256: createHash('sha256').update(outputBytes).digest('hex'),
    },
    externalReadback: {
      implementation: ffmpegVersion.stdout.split('\n')[0]?.trim() ?? 'ffmpeg',
      videoDecode: 'passed',
      audioDecode: 'passed',
      videoFrameMd5DocumentSha256: createHash('sha256').update(videoReadback.stdout).digest('hex'),
      audioPcmMd5: audioReadback.stdout.trim(),
    },
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log('Wrote ' + mediaPath + ' and ' + reportPath);
} finally {
  await browser?.close();
  await server.close();
}
