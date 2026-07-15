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
const mediaPath = resolve(outputDirectory, 'export-webm-vp9-opus.webm');
const reportPath = resolve(outputDirectory, 'export-webm-vp9-opus.json');
const server = await createServer({
  root,
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
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
      else reject(new Error(command + ' exited with ' + String(code) + '\n' + stderr));
    });
  });
}

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4175/apps/capability-lab/index.html', {
    waitUntil: 'domcontentloaded',
  });
  const evidence = await page.evaluate(async () => {
    const { exportWebM, SeekableMemorySink } = await import('/packages/export/src/index.ts');
    const { createSampleIndex, decodeVideoFrameAt } = await import('/packages/media/src/index.ts');
    const sink = new SeekableMemorySink();
    const result = await exportWebM({
      durationUs: 1_000_000,
      width: 320,
      height: 180,
      frameRate: { numerator: 30, denominator: 1 },
      sampleRate: 48_000,
      channelCount: 2,
      videoBitrate: 1_000_000,
      audioBitrate: 96_000,
      sink: sink.writable,
      cleanupSink: () => sink.cleanup(),
      renderFrame: request => {
        const canvas = new OffscreenCanvas(request.width, request.height);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2D context unavailable');
        const progress = request.timestampUs / 1_000_000;
        context.fillStyle = `rgb(${Math.round(progress * 255)} 64 ${Math.round((1 - progress) * 255)})`;
        context.fillRect(0, 0, request.width, request.height);
        return Promise.resolve(
          new VideoFrame(canvas, {
            timestamp: request.timestampUs,
            duration: request.durationUs,
          }),
        );
      },
      renderAudio: request => {
        const pcm = new Float32Array(request.frameCount * request.channelCount);
        for (let frame = 0; frame < request.frameCount; frame += 1) {
          const absoluteFrame = request.startFrame + frame;
          const sample = Math.sin((absoluteFrame * 2 * Math.PI * 440) / request.sampleRate) * 0.05;
          for (let channel = 0; channel < request.channelCount; channel += 1) {
            pcm[frame * request.channelCount + channel] = sample;
          }
        }
        return Promise.resolve(pcm);
      },
    });
    const bytes = sink.finalize();
    const index = await createSampleIndex(bytes);
    const video = index.tracks.find(track => track.kind === 'video');
    const audio = index.tracks.find(track => track.kind === 'audio');
    const decoded = await decodeVideoFrameAt(bytes, 500_000);
    const readback = {
      container: index.container,
      durationUs: index.durationUs,
      videoCodec: video?.codecFamily ?? null,
      audioCodec: audio?.codecFamily ?? null,
      videoSamples: video === undefined ? 0 : (index.samples[video.id]?.length ?? 0),
      audioSamples: audio === undefined ? 0 : (index.samples[audio.id]?.length ?? 0),
      decodedTimestampUs: decoded.timestampUs,
      decodedWidth: decoded.frame.displayWidth,
      decodedHeight: decoded.frame.displayHeight,
    };
    decoded.close();
    return {
      bytes: Array.from(bytes),
      result,
      sink: sink.snapshot(),
      readback,
      userAgent: navigator.userAgent,
    };
  });
  const bytes = Uint8Array.from(evidence.bytes);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(mediaPath, bytes);
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
    command: 'pnpm report:export',
    generatedAt: new Date().toISOString(),
    browser: evidence.userAgent,
    artifact: {
      file: 'reports/baseline/export-webm-vp9-opus.webm',
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    export: evidence.result,
    sink: evidence.sink,
    readback: evidence.readback,
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
