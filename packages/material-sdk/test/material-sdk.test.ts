import { describe, expect, it } from 'vitest';

import {
  canonicalMaterialBytes,
  createDeterministicMaterialArchive,
  DEFAULT_MATERIAL_PACKAGE_BYTE_LIMITS,
  MATERIAL_PACKAGE_MAX_ARCHIVE_BYTES,
  MATERIAL_PACKAGE_MAX_BYTES,
  MATERIAL_PACKAGE_MAX_FILES,
  MATERIAL_PACKAGE_MAX_FILE_BYTES,
  MATERIAL_PACKAGE_MAX_MANIFEST_BYTES,
  MaterialRegistry,
  materialDefinition,
  materialGraph,
  packMaterialPackage,
  sha256Hex,
  validateAuthoredMaterial,
  verifyMaterialPackage,
  type MaterialPackageMetadata,
  type MaterialPackageFile,
  type PackedMaterialPackage,
} from '../src/index.js';
import type { JsonValue } from '@aelion/core';

const declarativeMetadata: MaterialPackageMetadata = {
  id: 'dev.example.transitions',
  version: '1.0.0',
  displayName: 'Example Transitions',
  publisher: { id: 'dev.example', name: 'Example Publisher' },
  license: 'MIT',
  engines: { aelion: '>=0.1.0 <1.0.0', nodeSet: 'aelion.visual.nodes/1.0.0' },
  trust: 'declarative',
};

function crossDissolve() {
  const graph = materialGraph(g => {
    const eased = g.transitionCurve(
      'easedProgress',
      g.systemFloat('transitionProgress'),
      g.parameterEnum('curve'),
    );
    const result = g.mix('mixFrames', g.inputFrame('from'), g.inputFrame('to'), eased);
    g.output('result', result);
  });
  return materialDefinition({
    id: 'cross-dissolve-authored',
    kind: 'visual-transition',
    display: { name: 'Cross Dissolve Authored' },
  })
    .enumParameter('curve', {
      default: 'smooth',
      values: ['linear', 'smooth'],
      affects: 'specialization',
    })
    .graph('graphs/cross-dissolve-authored.graph.json', graph)
    .build();
}

function measuredLimits(packed: PackedMaterialPackage) {
  return {
    maxFiles: packed.files.size,
    maxFileBytes: Math.max(
      ...[...packed.files]
        .filter(([path]) => path !== 'manifest.json')
        .map(([, data]) => data.byteLength),
    ),
    maxManifestBytes: packed.manifestBytes.byteLength,
    maxPackageBytes: [...packed.files.values()].reduce((total, data) => total + data.byteLength, 0),
    maxArchiveBytes: packed.archiveBytes.byteLength,
  };
}

async function replacePayload(
  packed: PackedMaterialPackage,
  path: string,
  data: Uint8Array,
): Promise<PackedMaterialPackage> {
  const files = new Map(packed.files);
  files.set(path, data);
  const manifest = {
    ...packed.manifest,
    files: await Promise.all(
      packed.manifest.files.map(async entry =>
        entry.path === path
          ? { ...entry, bytes: data.byteLength, sha256: await sha256Hex(data) }
          : entry,
      ),
    ),
  };
  const manifestBytes = canonicalMaterialBytes(manifest as unknown as JsonValue);
  files.set('manifest.json', manifestBytes);
  return {
    manifest,
    manifestBytes,
    files,
    archiveBytes: createDeterministicMaterialArchive(files),
    integrity: `sha256:${await sha256Hex(manifestBytes)}`,
  };
}

describe('Material Authoring SDK', () => {
  it('builds, type-checks, packs and resolves one declarative Material', async () => {
    const material = crossDissolve();
    const validation = validateAuthoredMaterial(material);
    expect(validation).toEqual({ valid: true, diagnostics: [] });

    const first = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [material],
    });
    const second = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [material],
    });
    expect(first.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.integrity).toBe(second.integrity);
    expect(first.archiveBytes).toEqual(second.archiveBytes);
    expect(new DataView(first.archiveBytes.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect([...first.manifest.files].map(value => value.path)).toEqual([
      'graphs/cross-dissolve-authored.graph.json',
      'materials/cross-dissolve-authored.material.json',
    ]);
    expect([...first.files.keys()]).toEqual([
      'manifest.json',
      'graphs/cross-dissolve-authored.graph.json',
      'materials/cross-dissolve-authored.material.json',
    ]);

    const registry = new MaterialRegistry();
    await registry.install(first, { expectedIntegrity: first.integrity });
    const resolved = await registry.resolveMaterial({
      packageId: declarativeMetadata.id,
      packageVersion: declarativeMetadata.version,
      packageIntegrity: first.integrity,
      materialId: material.definition.id,
    });
    expect(resolved.definition.kind).toBe('visual-transition');
    expect(resolved.graph?.nodes.map(value => value.id)).toEqual(['easedProgress', 'mixFrames']);
  });

  it('ignores non-authoritative manifest projections and bounds authored collections', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const sparseMaterials = new Array(1_000_000);
    const sparseFiles = new Array(1_000_000);

    await expect(
      verifyMaterialPackage({
        ...packed,
        manifest: { ...packed.manifest, materials: sparseMaterials } as never,
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyMaterialPackage({
        ...packed,
        manifest: { ...packed.manifest, files: sparseFiles } as never,
      }),
    ).resolves.toBeUndefined();

    const sparseWithinLimit = new Array(2);
    sparseWithinLimit[0] = packed.manifest.materials[0];
    await expect(
      verifyMaterialPackage({
        ...packed,
        manifest: { ...packed.manifest, materials: sparseWithinLimit } as never,
      }),
    ).resolves.toBeUndefined();

    const oversizedDefinition = {
      ...crossDissolve().definition,
      parameters: new Array(1_000_000),
    };
    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [{ definition: oversizedDefinition as never }],
      }),
    ).rejects.toThrow('has more than 64 entries');

    const material = crossDissolve();
    const oversizedGraph = { ...material.graph, nodes: new Array(1_000_000) };
    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [{ ...material, graph: oversizedGraph as never }],
      }),
    ).rejects.toThrow('has more than 128 entries');
  });

  it('uses the same schema contract for authoring and registry installation', async () => {
    const material = crossDissolve();
    const parameter = material.definition.parameters[0];
    if (parameter === undefined) throw new Error('Test Material has no parameter');
    const tooManyParameters = Array.from({ length: 65 }, (_, index) => ({
      ...parameter,
      id: index === 0 ? parameter.id : `unused${index.toString()}`,
      ui: { ...parameter.ui, order: index, label: `Parameter ${index.toString()}` },
    }));

    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [
          {
            ...material,
            definition: { ...material.definition, parameters: tooManyParameters },
          },
        ],
      }),
    ).rejects.toThrow('has more than 64 entries');

    await expect(
      packMaterialPackage({
        metadata: {
          ...declarativeMetadata,
          id: 'INVALID PACKAGE ID',
          version: 'not-semver',
          publisher: { id: 'INVALID PUBLISHER', name: 'Invalid Publisher' },
        },
        materials: [material],
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_INVALID');

    const valid = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [material],
    });
    await expect(new MaterialRegistry().install(valid)).resolves.toBeUndefined();
  });

  it('computes ZIP CRC with the Uint8Array intrinsic instead of an instance iterator', () => {
    const data = new Uint8Array([1, 2, 3]);
    let customIteratorCalls = 0;
    Object.defineProperty(data, Symbol.iterator, {
      value: (): IterableIterator<number> => {
        customIteratorCalls += 1;
        throw new Error('custom iterator must not be called');
      },
    });

    const archive = createDeterministicMaterialArchive(new Map([['resource.bin', data]]));
    expect(archive.byteLength).toBeGreaterThan(data.byteLength);
    expect(customIteratorCalls).toBe(0);
  });

  it('never reads an instance byteLength while writing a branded ZIP payload', () => {
    const data = new Uint8Array([1, 2, 3]);
    let byteLengthReads = 0;
    Object.defineProperty(data, 'byteLength', {
      get(): never {
        byteLengthReads += 1;
        throw new Error('instance byteLength must not be read');
      },
    });

    expect(createDeterministicMaterialArchive(new Map([['resource.bin', data]])).byteLength).toBe(
      125,
    );
    expect(byteLengthReads).toBe(0);
  });

  it('never dispatches through caller-controlled pack input iterators', async () => {
    const material = crossDissolve();
    const materials = [material];
    const files: MaterialPackageFile[] = [];
    let iteratorCalls = 0;
    for (const input of [materials, files]) {
      Object.defineProperty(input, Symbol.iterator, {
        value: (): never => {
          iteratorCalls += 1;
          throw new Error('custom iterator must not be called');
        },
      });
    }

    await expect(
      packMaterialPackage({ metadata: declarativeMetadata, materials, files }),
    ).resolves.toMatchObject({ manifest: { materials: [{ id: material.definition.id }] } });
    expect(iteratorCalls).toBe(0);
  });

  it('detects tampered payload bytes before installation', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const files = new Map(packed.files);
    const definitionPath = 'materials/cross-dissolve-authored.material.json';
    const original = files.get(definitionPath);
    if (original === undefined) throw new Error('Test package has no Definition');
    const corrupted = new Uint8Array(original);
    corrupted[0] = corrupted[0] === 0x7b ? 0x5b : 0x7b;
    files.set(definitionPath, corrupted);
    const tampered: PackedMaterialPackage = { ...packed, files };
    await expect(verifyMaterialPackage(tampered)).rejects.toThrow('MATERIAL_INTEGRITY_MISMATCH');
  });

  it('publishes the protocol transport defaults and accepts every exact byte boundary', async () => {
    expect(DEFAULT_MATERIAL_PACKAGE_BYTE_LIMITS).toEqual({
      maxFiles: 256,
      maxFileBytes: 32 * 1024 * 1024,
      maxManifestBytes: 256 * 1024,
      maxPackageBytes: 64 * 1024 * 1024,
      maxArchiveBytes: 65 * 1024 * 1024,
    });
    expect(MATERIAL_PACKAGE_MAX_FILES).toBe(256);
    expect(MATERIAL_PACKAGE_MAX_FILE_BYTES).toBe(32 * 1024 * 1024);
    expect(MATERIAL_PACKAGE_MAX_MANIFEST_BYTES).toBe(256 * 1024);
    expect(MATERIAL_PACKAGE_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(MATERIAL_PACKAGE_MAX_ARCHIVE_BYTES).toBe(65 * 1024 * 1024);

    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const limits = measuredLimits(packed);
    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [crossDissolve()],
        limits,
      }),
    ).resolves.toMatchObject({ integrity: packed.integrity });
    await expect(verifyMaterialPackage(packed, packed.integrity, limits)).resolves.toBeUndefined();
  });

  it('rejects each package transport budget at one byte or one file over its boundary', async () => {
    const options = { metadata: declarativeMetadata, materials: [crossDissolve()] } as const;
    const packed = await packMaterialPackage(options);
    const limits = measuredLimits(packed);

    await expect(
      packMaterialPackage({ ...options, limits: { ...limits, maxFiles: limits.maxFiles - 1 } }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
    await expect(
      packMaterialPackage({
        ...options,
        limits: { ...limits, maxFileBytes: limits.maxFileBytes - 1 },
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
    await expect(
      packMaterialPackage({
        ...options,
        limits: { ...limits, maxManifestBytes: limits.maxManifestBytes - 1 },
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
    await expect(
      packMaterialPackage({
        ...options,
        limits: { ...limits, maxPackageBytes: limits.maxPackageBytes - 1 },
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
    await expect(
      packMaterialPackage({
        ...options,
        limits: { ...limits, maxArchiveBytes: limits.maxArchiveBytes - 1 },
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
  });

  it('rejects oversized aggregate payloads and archives before snapshot or ZIP allocation', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const limits = measuredLimits(packed);
    await expect(
      verifyMaterialPackage(packed, undefined, {
        ...limits,
        maxPackageBytes: limits.maxPackageBytes - 1,
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
    await expect(
      new MaterialRegistry({
        limits: { ...limits, maxArchiveBytes: limits.maxArchiveBytes - 1 },
      }).install(packed),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
  });

  it('rejects an oversized input file before reading or copying its indexed bytes', async () => {
    const backing = new Uint8Array(8);
    let indexedReads = 0;
    const guarded = new Proxy(backing, {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/u.test(property)) indexedReads += 1;
        return Reflect.get(target, property, target) as unknown;
      },
    });
    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [crossDissolve()],
        files: [
          { path: 'resources/oversized.bin', mediaType: 'application/octet-stream', data: guarded },
        ],
        limits: { maxFileBytes: 7 },
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');
    expect(indexedReads).toBe(0);
  });

  it('uses one 256-entry file limit across pack, snapshot, ZIP and manifest validation', async () => {
    const base = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const existingPayloads = base.files.size - 1;
    const exactAdditionalFiles = Array.from(
      { length: MATERIAL_PACKAGE_MAX_FILES - existingPayloads - 1 },
      (_, index) => ({
        path: `resources/${index.toString().padStart(3, '0')}.bin`,
        mediaType: 'application/octet-stream',
        data: new Uint8Array(),
      }),
    );
    const exact = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
      files: exactAdditionalFiles,
    });
    expect(exact.files.size).toBe(MATERIAL_PACKAGE_MAX_FILES);
    await expect(verifyMaterialPackage(exact)).resolves.toBeUndefined();

    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [crossDissolve()],
        files: [
          ...exactAdditionalFiles,
          {
            path: 'resources/over.bin',
            mediaType: 'application/octet-stream',
            data: new Uint8Array(),
          },
        ],
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_BUDGET_EXCEEDED');

    const tooManyFiles = new Map(exact.files);
    tooManyFiles.set('resources/over.bin', new Uint8Array());
    await expect(verifyMaterialPackage({ ...exact, files: tooManyFiles })).rejects.toThrow(
      'MATERIAL_PACKAGE_BUDGET_EXCEEDED',
    );
    expect(() => createDeterministicMaterialArchive(tooManyFiles)).toThrow(
      'MATERIAL_PACKAGE_BUDGET_EXCEEDED',
    );
  });

  it('does not trust forged byteLength values or non-branded transport containers', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    await expect(
      verifyMaterialPackage({
        ...packed,
        archiveBytes: { byteLength: 0 } as unknown as Uint8Array,
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_INVALID');

    const files = new Map(packed.files);
    files.set('forged.bin', { byteLength: 0 } as unknown as Uint8Array);
    await expect(verifyMaterialPackage({ ...packed, files })).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );
    await expect(
      verifyMaterialPackage({
        ...packed,
        archiveBytes: new Proxy(packed.archiveBytes, {
          get(target, property) {
            if (property === 'byteLength') return 0;
            return Reflect.get(target, property) as unknown;
          },
        }),
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_INVALID');
    await expect(
      verifyMaterialPackage({
        ...packed,
        files: new Proxy(packed.files as Map<string, Uint8Array>, {
          get(target, property) {
            if (property === 'size') return 0;
            return Reflect.get(target, property, target) as unknown;
          },
        }),
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_INVALID');
    expect(() =>
      createDeterministicMaterialArchive(
        new Proxy(new Map(packed.files), {
          get(target, property) {
            if (property === 'size') return 0;
            return Reflect.get(target, property, target) as unknown;
          },
        }),
      ),
    ).toThrow('MATERIAL_PACKAGE_INVALID');
  });

  it.each([
    '../escape.bin',
    'resources/../escape.bin',
    '/absolute.bin',
    'resources\\escape.bin',
    'resources//empty.bin',
    './relative.bin',
    'resources/./relative.bin',
    'resources/trailing/',
    'signature.json',
  ])('rejects unsafe or reserved package path %s everywhere', async path => {
    await expect(
      packMaterialPackage({
        metadata: declarativeMetadata,
        materials: [crossDissolve()],
        files: [{ path, mediaType: 'application/octet-stream', data: new Uint8Array() }],
      }),
    ).rejects.toThrow(/Unsafe|MATERIAL_PACKAGE_INVALID/u);
    expect(() => createDeterministicMaterialArchive(new Map([[path, new Uint8Array()]]))).toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );
  });

  it('rejects ill-formed Unicode paths before UTF-8 encoding across every transport entrypoint', async () => {
    const firstPath = 'resources/\ud800.bin';
    const secondPath = 'resources/\ud801.bin';
    const trailingHighSurrogate = 'resources/trailing-\ud800';
    expect(new TextEncoder().encode(firstPath)).toEqual(new TextEncoder().encode(secondPath));

    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    for (const path of [firstPath, secondPath, trailingHighSurrogate]) {
      await expect(
        packMaterialPackage({
          metadata: declarativeMetadata,
          materials: [crossDissolve()],
          files: [{ path, mediaType: 'application/octet-stream', data: new Uint8Array([1]) }],
        }),
      ).rejects.toThrow(/Unsafe|MATERIAL_PACKAGE_INVALID/u);
      expect(() =>
        createDeterministicMaterialArchive(new Map([[path, new Uint8Array([1])]])),
      ).toThrow('MATERIAL_PACKAGE_INVALID');

      const files = new Map(packed.files);
      files.set(path, new Uint8Array([1]));
      const malformed = { ...packed, files };
      await expect(verifyMaterialPackage(malformed)).rejects.toThrow('unsafe file path');
      await expect(new MaterialRegistry().install(malformed)).rejects.toThrow('unsafe file path');
    }
  });

  it('rejects non-string transport paths without coercing untrusted Map keys', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    let coercions = 0;
    const untrustedPath = {
      [Symbol.toPrimitive](): never {
        coercions += 1;
        throw new Error('untrusted path coercion must not run');
      },
    };
    const archiveFiles = new Map<unknown, Uint8Array>([[untrustedPath, new Uint8Array([1])]]);
    expect(() =>
      createDeterministicMaterialArchive(
        archiveFiles as unknown as ReadonlyMap<string, Uint8Array>,
      ),
    ).toThrow('unsafe ZIP path');
    expect(coercions).toBe(0);

    const files = new Map<unknown, Uint8Array>(packed.files);
    files.set(untrustedPath, new Uint8Array([1]));
    await expect(
      verifyMaterialPackage({
        ...packed,
        files: files as unknown as ReadonlyMap<string, Uint8Array>,
      }),
    ).rejects.toThrow('unsafe file path');
    expect(coercions).toBe(0);
  });

  it('uses signed manifest bytes instead of an untrusted convenience projection', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    let ownKeysCalls = 0;
    const projectedManifest = new Proxy(packed.manifest, {
      ownKeys(): never {
        ownKeysCalls += 1;
        throw new Error('manifest projection must not be enumerated');
      },
    });
    await expect(
      verifyMaterialPackage({ ...packed, manifest: projectedManifest }),
    ).resolves.toBeUndefined();
    const registry = new MaterialRegistry();
    await expect(
      registry.install({ ...packed, manifest: projectedManifest }),
    ).resolves.toBeUndefined();
    expect(ownKeysCalls).toBe(0);
    await expect(
      verifyMaterialPackage({
        ...packed,
        manifest: null as unknown as PackedMaterialPackage['manifest'],
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyMaterialPackage({
        ...packed,
        manifest: {
          ...packed.manifest,
          unexpected: true,
        } as unknown as PackedMaterialPackage['manifest'],
      }),
    ).resolves.toBeUndefined();
    const first = packed.manifest.files[0];
    if (first === undefined) throw new Error('Test package has no payload entry');
    await expect(
      verifyMaterialPackage({
        ...packed,
        manifest: {
          ...packed.manifest,
          files: [{ ...first, bytes: Number.MAX_SAFE_INTEGER + 1 }],
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects accessor transport fields without invoking caller code', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    let getterCalls = 0;
    const accessor = Object.create(null) as PackedMaterialPackage;
    for (const key of ['manifestBytes', 'files', 'archiveBytes', 'integrity'] as const) {
      Object.defineProperty(accessor, key, {
        enumerable: true,
        get(): never {
          getterCalls += 1;
          throw new Error('transport getter must not be called');
        },
      });
    }
    Object.defineProperty(accessor, 'manifest', { value: packed.manifest, enumerable: true });

    await expect(verifyMaterialPackage(accessor)).rejects.toThrow('own data property');
    expect(getterCalls).toBe(0);
  });

  it('snapshots inspected transport fields without invoking Proxy get traps', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    let integrityReads = 0;
    const proxy = new Proxy(packed, {
      get(target, property, receiver) {
        if (property === 'integrity') {
          integrityReads += 1;
          throw new Error('inspected integrity must not be read again');
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    await expect(verifyMaterialPackage(proxy)).resolves.toBeUndefined();
    const registry = new MaterialRegistry();
    await expect(registry.install(proxy)).resolves.toBeUndefined();
    expect(integrityReads).toBe(0);
  });

  it('rejects malformed authoritative manifest bytes before trust decisions', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const invalidJson = new TextEncoder().encode('{');
    await expect(verifyMaterialPackage({ ...packed, manifestBytes: invalidJson })).rejects.toThrow(
      'manifestBytes is not valid UTF-8 JSON',
    );

    const schemaInvalid = canonicalMaterialBytes({
      $schema: 'https://aelion.dev/schemas/material/v1/package.schema.json',
      protocolVersion: '1.0.0',
      package: null,
      materials: [],
      files: [],
    });
    await expect(
      verifyMaterialPackage({ ...packed, manifestBytes: schemaInvalid }),
    ).rejects.toThrow('MATERIAL_PACKAGE_INVALID');
  });

  it('rejects integrity-valid malformed Definition and Graph JSON before semantic access', async () => {
    const metadata = {
      ...declarativeMetadata,
      publisher: { ...declarativeMetadata.publisher },
      engines: { ...declarativeMetadata.engines },
    };
    const packed = await packMaterialPackage({
      metadata,
      materials: [crossDissolve()],
    });
    const definitionPath = 'materials/cross-dissolve-authored.material.json';
    const malformedDefinition = await replacePayload(
      packed,
      definitionPath,
      new TextEncoder().encode('[]'),
    );
    await expect(new MaterialRegistry().install(malformedDefinition)).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );

    const graphPath = 'graphs/cross-dissolve-authored.graph.json';
    const malformedGraph = await replacePayload(
      packed,
      graphPath,
      new TextEncoder().encode('{"nodes":"not-an-array"}'),
    );
    await expect(new MaterialRegistry().install(malformedGraph)).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );

    const malformedDefinitionObject = await replacePayload(
      packed,
      definitionPath,
      canonicalMaterialBytes({
        ...crossDissolve().definition,
        execution: { color: null },
      } as unknown as JsonValue),
    );
    await expect(new MaterialRegistry().install(malformedDefinitionObject)).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );

    const schemaInvalidDefinition = await replacePayload(
      packed,
      definitionPath,
      canonicalMaterialBytes({
        ...crossDissolve().definition,
        scopes: [],
        unexpected: true,
      } as unknown as JsonValue),
    );
    await expect(new MaterialRegistry().install(schemaInvalidDefinition)).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );

    const malformedGraphBinding = await replacePayload(
      packed,
      graphPath,
      canonicalMaterialBytes({
        ...crossDissolve().graph,
        nodes: [
          {
            id: 'malformed',
            type: 'color.invert',
            typeVersion: '1.0.0',
            inputs: { source: { inputPort: 'from', parameter: 'also-invalid' } },
          },
        ],
        outputs: { result: { node: 'malformed', output: 'frame' } },
      } as unknown as JsonValue),
    );
    await expect(new MaterialRegistry().install(malformedGraphBinding)).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );

    const schemaInvalidGraph = await replacePayload(
      packed,
      graphPath,
      canonicalMaterialBytes({
        ...crossDissolve().graph,
        outputs: {},
        unexpected: true,
      } as unknown as JsonValue),
    );
    await expect(new MaterialRegistry().install(schemaInvalidGraph)).rejects.toThrow(
      'MATERIAL_PACKAGE_INVALID',
    );
  });

  it('rejects archive bytes that do not represent the verified file set', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const archiveBytes = new Uint8Array(packed.archiveBytes);
    const lastIndex = archiveBytes.byteLength - 1;
    archiveBytes[lastIndex] = (archiveBytes[lastIndex] ?? 0) ^ 1;

    await expect(verifyMaterialPackage({ ...packed, archiveBytes })).rejects.toThrow(
      'MATERIAL_INTEGRITY_MISMATCH',
    );
  });

  it('stores and resolves defensive snapshots after integrity verification', async () => {
    const packed = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [crossDissolve()],
    });
    const definitionPath = 'materials/cross-dissolve-authored.material.json';
    const originalDefinition = packed.files.get(definitionPath);
    if (originalDefinition === undefined) throw new Error('Test package has no Definition');
    const registry = new MaterialRegistry();
    await registry.install(packed, { expectedIntegrity: packed.integrity });

    originalDefinition.fill(0);
    Reflect.set(packed.manifest.package, 'trust', 'trusted-code');
    packed.archiveBytes.fill(0);

    const reference = {
      packageId: declarativeMetadata.id,
      packageVersion: declarativeMetadata.version,
      packageIntegrity: packed.integrity,
      materialId: 'cross-dissolve-authored',
    };
    const first = await registry.resolve(reference);
    first.files.get(definitionPath)?.fill(0);
    Reflect.set(first.manifest.package, 'trust', 'trusted-code');
    const second = await registry.resolveMaterial(reference);

    expect(second.manifest.package.trust).toBe('declarative');
    expect(second.definition.kind).toBe('visual-transition');
    expect(second.graph?.nodes.map(value => value.id)).toEqual(['easedProgress', 'mixFrames']);
  });

  it('rejects executable code unless both policy and publisher authorization are explicit', async () => {
    const codeMaterial = materialDefinition({
      id: 'trusted-filter',
      kind: 'visual-filter',
      display: { name: 'Trusted Filter' },
    })
      .trustedImplementation({
        type: 'shader',
        backend: 'webgpu',
        abi: 'aelion-material-shader/1',
        module: 'shaders/trusted-filter.wgsl',
        entryPoint: 'main',
      })
      .build();
    const declarative = await packMaterialPackage({
      metadata: declarativeMetadata,
      materials: [codeMaterial],
      files: [
        {
          path: 'shaders/trusted-filter.wgsl',
          mediaType: 'text/wgsl',
          data: '@fragment fn main() {}',
        },
      ],
    });
    await expect(new MaterialRegistry().install(declarative)).rejects.toThrow(
      'MATERIAL_TRUST_REQUIRED',
    );

    const trusted = await packMaterialPackage({
      metadata: { ...declarativeMetadata, trust: 'trusted-code' },
      materials: [codeMaterial],
      files: [
        {
          path: 'shaders/trusted-filter.wgsl',
          mediaType: 'text/wgsl',
          data: '@fragment fn main() {}',
        },
      ],
    });
    const registry = new MaterialRegistry();
    await expect(registry.install(trusted, { authorizeTrustedCode: true })).rejects.toThrow(
      'MATERIAL_TRUST_REQUIRED',
    );
    await expect(
      registry.install(trusted, {
        authorizeTrustedCode: true,
        trustedPublisherIds: new Set(['dev.example']),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a trusted implementation whose declared code payload is absent', async () => {
    const codeMaterial = materialDefinition({
      id: 'missing-code-filter',
      kind: 'visual-filter',
      display: { name: 'Missing Code Filter' },
    })
      .trustedImplementation({
        type: 'wasm',
        module: 'wasm/missing.wasm',
        abi: 'aelion-material-wasm/1',
      })
      .build();
    const packed = await packMaterialPackage({
      metadata: { ...declarativeMetadata, trust: 'trusted-code' },
      materials: [codeMaterial],
    });
    await expect(
      new MaterialRegistry().install(packed, {
        authorizeTrustedCode: true,
        trustedPublisherIds: new Set(['dev.example']),
      }),
    ).rejects.toThrow('MATERIAL_PACKAGE_INVALID');
  });

  it('reports authoring diagnostics from the runtime Core Node compiler', () => {
    const material = crossDissolve();
    const first = material.graph?.nodes[0];
    if (first === undefined || material.graph === undefined) throw new Error('Test Graph is empty');
    first.inputs.progress = { node: 'mixFrames', output: 'frame' };
    const result = validateAuthoredMaterial(material);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MATERIAL_DEPENDENCY_CYCLE' })]),
    );
  });
});
