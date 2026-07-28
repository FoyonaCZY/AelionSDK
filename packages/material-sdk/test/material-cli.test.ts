import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMaterialAuthorPackage,
  compareMaterialGoldenFiles,
  generateMaterialTypes,
  initializeMaterialAuthorPackage,
  packMaterialAuthorPackage,
  prepublishMaterialAuthorPackage,
  validateMaterialAuthorPackage,
  writeMaterialPreviewReport,
} from '../src/cli-lib.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aelion-material-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  );
});

describe.sequential('Material author CLI library', () => {
  it('scaffolds, validates, type-generates, previews and packs a deterministic package', async () => {
    const directory = await temporaryDirectory();
    await initializeMaterialAuthorPackage(directory);

    const inspection = await validateMaterialAuthorPackage(directory);
    expect(inspection).toMatchObject({
      packageId: 'dev.example.starter',
      version: '0.1.0',
      files: 3,
      materials: [
        {
          id: 'starter-filter',
          webgl2: true,
          webgpu: true,
        },
      ],
    });
    await expect(prepublishMaterialAuthorPackage(directory)).resolves.toEqual(inspection);

    const typesPath = await generateMaterialTypes(directory);
    expect(await readFile(typesPath, 'utf8')).toContain('export interface StarterFilterParameters');

    const previewPath = await writeMaterialPreviewReport(directory);
    expect(JSON.parse(await readFile(previewPath, 'utf8'))).toMatchObject({
      reportVersion: '1.0.0',
      package: { id: 'dev.example.starter', integrity: inspection.integrity },
      materials: [{ id: 'starter-filter' }],
    });

    const firstPath = join(directory, 'first.aelionmat');
    const secondPath = join(directory, 'second.aelionmat');
    const first = await packMaterialAuthorPackage(directory, firstPath);
    const second = await packMaterialAuthorPackage(directory, secondPath);
    expect(first.integrity).toBe(second.integrity);
    expect(await readFile(firstPath)).toEqual(await readFile(secondPath));
  });

  it('compares raw Golden buffers with an explicit tolerance', async () => {
    const directory = await temporaryDirectory();
    const actualPath = join(directory, 'actual.rgba');
    const expectedPath = join(directory, 'expected.rgba');
    await writeFile(actualPath, new Uint8Array([10, 20, 30]));
    await writeFile(expectedPath, new Uint8Array([12, 22, 35]));

    await expect(compareMaterialGoldenFiles(actualPath, expectedPath, 2)).resolves.toMatchObject({
      passed: false,
      comparedValues: 3,
      differingValues: 1,
      maximumError: 5,
    });
    await expect(compareMaterialGoldenFiles(actualPath, expectedPath, 5)).resolves.toMatchObject({
      passed: true,
      differingValues: 0,
    });
  });

  it('rebuilds payload hashes after an author edits declared source files', async () => {
    const directory = await temporaryDirectory();
    await initializeMaterialAuthorPackage(directory);
    const before = await validateMaterialAuthorPackage(directory);
    const definitionPath = join(directory, 'materials', 'starter-filter.material.json');
    const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as {
      display: { name: string };
    };
    definition.display.name = 'Edited Starter Filter';
    await writeFile(definitionPath, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');

    await expect(validateMaterialAuthorPackage(directory)).rejects.toThrow(
      'MATERIAL_INTEGRITY_MISMATCH',
    );
    const built = await buildMaterialAuthorPackage(directory);
    expect(built.inspection.integrity).not.toBe(before.integrity);
    await expect(validateMaterialAuthorPackage(directory)).resolves.toEqual(built.inspection);
  });
});
