#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mediaDirectory = join(root, 'fixtures', 'media');
const manifestPath = join(root, 'fixtures', 'manifests', 'media-v1.json');

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

const commonInput = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=30:duration=3',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=997:sample_rate=48000:duration=3',
  '-map',
  '0:v:0',
  '-map',
  '1:a:0',
  '-metadata',
  'creation_time=1970-01-01T00:00:00Z',
  '-metadata',
  'encoder=AelionSDK fixture generator',
];

const definitions = [
  {
    id: 'mp4-moov-head-h264-aac',
    file: 'mp4-moov-head-h264-aac.mp4',
    args: [
      ...commonInput,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-x264-params',
      'keyint=30:min-keyint=30:scenecut=0:bframes=2:threads=1',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
    ],
    container: 'mp4',
    features: ['moov-head', 'b-frames', 'cfr', 'audio-video'],
    expected: {
      durationUs: 3_000_000,
      video: {
        codecFamily: 'avc',
        width: 320,
        height: 180,
        variableFrameRate: false,
        hasBFrames: true,
      },
      audio: { codecFamily: 'aac', sampleRate: 48000, channels: 1 },
    },
  },
  {
    id: 'mp4-fragmented-h264-aac',
    file: 'mp4-fragmented-h264-aac.mp4',
    args: [
      ...commonInput,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-x264-params',
      'keyint=30:min-keyint=30:scenecut=0:bframes=2:threads=1',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+frag_keyframe+empty_moov+default_base_moof',
    ],
    container: 'mp4',
    features: ['fragmented', 'b-frames', 'cfr', 'audio-video'],
    expected: {
      durationUs: 3_000_000,
      video: {
        codecFamily: 'avc',
        width: 320,
        height: 180,
        variableFrameRate: false,
        hasBFrames: true,
      },
      audio: { codecFamily: 'aac', sampleRate: 48000, channels: 1 },
    },
  },
  {
    id: 'mp4-moov-tail-h264-aac',
    file: 'mp4-moov-tail-h264-aac.mp4',
    args: [
      ...commonInput,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-x264-params',
      'keyint=30:min-keyint=30:scenecut=0:bframes=2:threads=1',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
    ],
    container: 'mp4',
    features: ['moov-tail', 'b-frames', 'cfr', 'audio-video'],
    expected: {
      durationUs: 3_000_000,
      video: {
        codecFamily: 'avc',
        width: 320,
        height: 180,
        variableFrameRate: false,
        hasBFrames: true,
      },
      audio: { codecFamily: 'aac', sampleRate: 48000, channels: 1 },
    },
  },
  {
    id: 'mp4-nonzero-pts-h264-aac',
    file: 'mp4-nonzero-pts-h264-aac.mp4',
    args: [
      ...commonInput,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-x264-params',
      'keyint=30:min-keyint=30:scenecut=0:bframes=2:threads=1',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-output_ts_offset',
      '0.5',
    ],
    container: 'mp4',
    features: ['nonzero-pts', 'b-frames', 'cfr', 'audio-video'],
    expected: {
      durationUs: 3_000_000,
      video: {
        codecFamily: 'avc',
        width: 320,
        height: 180,
        firstPresentationUs: 500_000,
        variableFrameRate: false,
        hasBFrames: true,
      },
      audio: { codecFamily: 'aac', sampleRate: 48000, channels: 1 },
    },
  },
  {
    id: 'webm-vp9-opus-vfr',
    file: 'webm-vp9-opus-vfr.webm',
    args: [
      ...commonInput,
      '-filter:v',
      'select=not(mod(n\\,2))+not(mod(n\\,5))',
      '-fps_mode',
      'vfr',
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '30',
      '-threads',
      '1',
      '-row-mt',
      '0',
      '-c:a',
      'libopus',
      '-b:a',
      '96k',
      '-f',
      'webm',
    ],
    container: 'webm',
    features: ['vfr', 'vp9', 'opus', 'multiple-clusters', 'audio-video'],
    expected: {
      durationUs: 3_000_000,
      video: {
        codecFamily: 'vp9',
        width: 320,
        height: 180,
        variableFrameRate: true,
        hasBFrames: false,
      },
      audio: { codecFamily: 'opus', sampleRate: 48000, channels: 1 },
    },
  },
];

await mkdir(mediaDirectory, { recursive: true });
const version = await run('ffmpeg', ['-version']);
const ffmpegVersion = version.stdout.split('\n')[0]?.trim() ?? 'unknown';
const fixtures = [];

for (const definition of definitions) {
  const absolutePath = join(mediaDirectory, definition.file);
  await run('ffmpeg', [...definition.args, absolutePath]);
  const bytes = await readFile(absolutePath);
  fixtures.push({
    id: definition.id,
    file: relative(root, absolutePath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    license: 'CC0-1.0',
    container: definition.container,
    features: definition.features,
    expected: definition.expected,
  });
}

const manifest = {
  manifestVersion: '1.0.0',
  generator: {
    command: 'pnpm fixtures:generate',
    ffmpegVersion,
  },
  fixtures,
};

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Generated ' + String(fixtures.length) + ' media fixtures and ' + manifestPath);
