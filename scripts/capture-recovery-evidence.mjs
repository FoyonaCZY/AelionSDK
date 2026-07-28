#!/usr/bin/env node

import { Buffer } from 'node:buffer';
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
import { validateRecoveryEvidence } from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'reports', 'baseline', 'recovery-chromium.json');
const server = await createServer({
  configFile: resolve(root, 'apps', 'evidence-runner', 'vite.config.ts'),
});

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      const output = Buffer.concat(stdout);
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code === 0) resolvePromise({ stdout: output, stderr: errorOutput });
      else reject(new Error(`${command} exited with ${String(code)}\n${errorOutput}`));
    });
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseFrameMd5(stdout) {
  const text = stdout.toString('utf8');
  const timeBase = text.match(/^#tb\s+0:\s*(\d+)\/(\d+)\s*$/mu);
  if (timeBase === null) throw new Error('FFmpeg framemd5 time base is missing');
  const numerator = Number.parseInt(timeBase[1], 10);
  const denominator = Number.parseInt(timeBase[2], 10);
  const frames = text
    .split(/\r?\n/u)
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => {
      const columns = line.split(',').map(value => value.trim());
      if (columns.length !== 6 || !/^[0-9a-f]{32}$/u.test(columns[5] ?? '')) {
        throw new Error(`Invalid FFmpeg framemd5 row: ${line}`);
      }
      return {
        pts: Number.parseInt(columns[2], 10),
        duration: Number.parseInt(columns[3], 10),
        md5: columns[5],
      };
    });
  const last = frames.at(-1);
  if (last === undefined) throw new Error('FFmpeg decoded no video frames');
  return {
    hashes: frames.map(frame => frame.md5),
    endUs: Math.round(((last.pts + last.duration) * numerator * 1_000_000) / denominator),
  };
}

async function ffmpegReadback(ffmpeg, path, sampleRate, channelCount, expectedAudioFrames) {
  const [video, audioTimeline, audioPcm] = await Promise.all([
    run(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-f',
      'framemd5',
      '-',
    ]),
    run(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-f',
      'framemd5',
      '-',
    ]),
    run(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-ac',
      channelCount.toString(),
      '-ar',
      sampleRate.toString(),
      '-acodec',
      'pcm_f32le',
      '-f',
      'f32le',
      '-',
    ]),
  ]);
  const frameBytes = channelCount * Float32Array.BYTES_PER_ELEMENT;
  if (audioPcm.stdout.byteLength % frameBytes !== 0) {
    throw new Error('FFmpeg PCM readback is not frame-aligned');
  }
  const videoReadback = parseFrameMd5(video.stdout);
  const audioTimelineReadback = parseFrameMd5(audioTimeline.stdout);
  const decodedPcmFrames = audioPcm.stdout.byteLength / frameBytes;
  const audioEndUs = Math.round((expectedAudioFrames * 1_000_000) / sampleRate);
  return {
    videoFrames: videoReadback.hashes.length,
    videoFrameMd5: videoReadback.hashes,
    videoEndUs: videoReadback.endUs,
    decodedPcmFrames,
    audioPcmSha256: sha256(audioPcm.stdout),
    audioEndUs,
    codecPacketEndUs: audioTimelineReadback.endUs,
    codecTailFrames: decodedPcmFrames - expectedAudioFrames,
    avEndDriftUs: Math.abs(videoReadback.endUs - audioEndUs),
  };
}

let browser;
let temporaryDirectory;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4176/apps/evidence-runner/recovery.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      Reflect.has(globalThis, '__AELION_RECOVERY_EVIDENCE__') ||
      Reflect.has(globalThis, '__AELION_RECOVERY_ERROR__'),
    undefined,
    { timeout: 10 * 60_000 },
  );
  const failure = await page.evaluate(() => Reflect.get(globalThis, '__AELION_RECOVERY_ERROR__'));
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
  const browserEvidence = await page.evaluate(() =>
    Reflect.get(globalThis, '__AELION_RECOVERY_EVIDENCE__'),
  );
  if (!Array.isArray(browserEvidence?.artifacts) || browserEvidence.artifacts.length !== 8) {
    throw new Error('Browser recovery artifact matrix is incomplete');
  }

  const version = await run(ffmpegCommand, ['-version']);
  const externalDecoder = version.stdout.toString('utf8').split(/\r?\n/u)[0]?.trim() ?? 'ffmpeg';
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'aelion-recovery-'));
  const decoded = [];
  for (const artifact of browserEvidence.artifacts) {
    const bytes = Uint8Array.from(artifact.bytes);
    const extension = artifact.profile === 'webm-vp9-opus' ? 'webm' : 'mp4';
    const path = join(temporaryDirectory, `${artifact.id}.${extension}`);
    await writeFile(path, bytes);
    const readback = await ffmpegReadback(
      ffmpegCommand,
      path,
      browserEvidence.sampleRate,
      browserEvidence.channelCount,
      browserEvidence.audioFrames,
    );
    const firstRenderedFrame = artifact.renderedFrames.at(0) ?? null;
    const firstUncommittedFrame = artifact.firstRunCommittedUnits * 6;
    decoded.push({
      id: artifact.id,
      profile: artifact.profile,
      interruptionFraction: artifact.interruptionFraction,
      totalUnits: artifact.totalUnits,
      reusedUnits: artifact.reusedUnits,
      encodedUnits: artifact.encodedUnits,
      firstRunCommittedUnits: artifact.firstRunCommittedUnits,
      renderedFrameCount: artifact.renderedFrames.length,
      firstRenderedFrame,
      rerenderedCommittedFrames: artifact.renderedFrames.filter(
        frame => frame < firstUncommittedFrame,
      ).length,
      bytes: bytes.byteLength,
      artifactSha256: sha256(bytes),
      readback,
    });
  }

  const [referenceDevice, browserIdentity] = await Promise.all([
    probeReferenceDevice(),
    captureBrowserIdentity(browser, page),
  ]);
  const profiles = ['webm-vp9-opus', 'mp4-h264-aac'].map(profile => {
    const artifacts = decoded.filter(value => value.profile === profile);
    return {
      profile,
      reference: artifacts.find(value => value.interruptionFraction === null),
      recoveries: artifacts.filter(value => value.interruptionFraction !== null),
    };
  });
  const report = {
    evidenceVersion: browserEvidence.evidenceVersion,
    command: 'corepack pnpm report:recovery',
    generatedAt: new Date().toISOString(),
    fixture: browserEvidence.fixture,
    durationUs: browserEvidence.durationUs,
    sampleRate: browserEvidence.sampleRate,
    channelCount: browserEvidence.channelCount,
    videoFrames: browserEvidence.videoFrames,
    audioFrames: browserEvidence.audioFrames,
    methodology: {
      checkpointStore: 'IndexedDB recreated between interrupted and resumed runs',
      interruptionFractions: [0.25, 0.5, 0.9],
      semanticComparison:
        'FFmpeg per-frame decoded MD5 sequence plus SHA-256 of decoded float32 PCM',
      codecTailPolicy:
        'PCM SHA-256 includes complete codec packet tails; logical A/V end uses the requested PCM frame count, while codecPacketEndUs and codecTailFrames disclose packet quantization separately',
      avEndDriftLimitUs: 1_000,
    },
    externalDecoder,
    referenceDevice: {
      ...referenceDevice,
      ...browserIdentity,
    },
    browserVersion: browserIdentity.browserVersion,
    userAgent: browserIdentity.userAgent,
    profiles,
  };
  if (process.env.AELION_RECOVERY_RAW_PATH) {
    await writeFile(
      resolve(root, process.env.AELION_RECOVERY_RAW_PATH),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  await publishValidatedJson({
    outputPath,
    document: report,
    validate: validateRecoveryEvidence,
  });
  console.log(`Wrote ${outputPath}`);
} finally {
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  await browser?.close();
  await server.close();
}
