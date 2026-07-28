import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { migrateProjectFile } from '../src/migrate-cli-lib.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-migrate-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function doesNotExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  );
});

describe.sequential('project migration CLI library', () => {
  it('writes a validated WebAV project and a deterministic loss report', async () => {
    const directory = await temporaryDirectory();
    const inputPath = join(directory, 'webav.json');
    const outputPath = join(directory, 'project.json');
    const reportPath = join(directory, 'report.json');
    await writeJson(inputPath, {
      width: 640,
      height: 360,
      assets: [{ id: 'still', kind: 'image' }],
      sprites: [
        {
          id: 'title-card',
          kind: 'image',
          assetId: 'still',
          time: { offset: 0, duration: 1_000_000 },
        },
      ],
    });

    const first = await migrateProjectFile({
      source: 'webav',
      inputPath,
      outputPath,
      reportPath,
    });
    expect(first).toMatchObject({
      status: 'passed',
      strict: true,
      dryRun: false,
      diagnosticSummary: { info: 0, warning: 0, error: 0 },
      entityMap: { 'webav:title-card': 'webav_item_0' },
    });
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({
      projectId: first.projectId,
      items: { webav_item_0: { type: 'image' } },
    });
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(first);

    const second = await migrateProjectFile({
      source: 'webav',
      inputPath,
      outputPath,
      reportPath,
    });
    expect(second.projectSha256).toBe(first.projectSha256);
  });

  it('writes the strict loss report but never emits a failed project', async () => {
    const directory = await temporaryDirectory();
    const inputPath = join(directory, 'unsupported.json');
    const outputPath = join(directory, 'must-not-exist.json');
    const reportPath = join(directory, 'loss.json');
    await writeJson(inputPath, {
      width: 640,
      height: 360,
      assets: [{ id: 'still', kind: 'image' }],
      sprites: [
        {
          id: 'invalid',
          kind: 'image',
          assetId: 'still',
          includeAudio: true,
          time: { offset: 0, duration: 1_000_000 },
        },
      ],
    });

    const report = await migrateProjectFile({
      source: 'webav',
      inputPath,
      outputPath,
      reportPath,
    });
    expect(report).toMatchObject({
      status: 'failed',
      diagnosticSummary: { error: 1 },
      diagnostics: [{ code: 'WEBAV_AUDIO_STREAM_UNAVAILABLE' }],
    });
    expect(report.outputPath).toBeUndefined();
    expect(await doesNotExist(outputPath)).toBe(true);
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report);
  });

  it('supports separate Diffusion assets and a no-output dry run', async () => {
    const directory = await temporaryDirectory();
    const inputPath = join(directory, 'checkpoint.json');
    const assetsPath = join(directory, 'assets.json');
    const outputPath = join(directory, 'must-not-exist.json');
    const reportPath = join(directory, 'dry-run.json');
    await writeJson(inputPath, {
      settings: { width: 640, height: 360 },
      layers: [
        {
          clips: [
            {
              id: 'hero',
              type: 'VIDEO',
              source: 'video-source',
              delay: 0,
              duration: 1,
              range: [0, 1],
              width: 640,
              height: 360,
            },
          ],
        },
      ],
    });
    await writeJson(assetsPath, [
      {
        sourceId: 'video-source',
        assetId: 'asset-video',
        kind: 'video',
        width: 640,
        height: 360,
        hasAudio: false,
      },
    ]);

    const report = await migrateProjectFile({
      source: 'diffusion',
      inputPath,
      assetsPath,
      outputPath,
      reportPath,
      dryRun: true,
    });
    expect(report).toMatchObject({
      source: 'diffusion',
      status: 'passed',
      dryRun: true,
      entityMap: { 'diffusion:hero': 'diffusion_item_0' },
    });
    expect(report.outputPath).toBeUndefined();
    expect(await doesNotExist(outputPath)).toBe(true);
  });
});
