import type { JsonValue } from '@aelion/core';
import { describe, expect, it } from 'vitest';

import {
  AdaptiveMaterialQualityController,
  compareMaterialGolden,
  createMaterialCompositionPlan,
  enforceMaterialExecutionPolicy,
  MaterialCatalog,
  materialDefinition,
  materialGraph,
  MaterialMigrationRegistry,
  MaterialLabSession,
  MaterialRegistry,
  MaterialTrustStore,
  packMaterialPackage,
  signMaterialPackage,
  type MaterialCompositionSlot,
  type MaterialPackageMetadata,
} from '../src/index.js';

const metadata: MaterialPackageMetadata = {
  id: 'dev.example.production',
  version: '1.0.0',
  displayName: 'Production fixtures',
  publisher: { id: 'dev.example', name: 'Example Publisher' },
  license: 'MIT',
  engines: { aelion: '>=0.1.0 <1.0.0', nodeSet: 'aelion.visual.nodes/1.0.0' },
  trust: 'declarative',
};

function filterMaterial() {
  const graph = materialGraph(builder => {
    builder.output('result', builder.invert('invert', builder.inputFrame('source')));
  });
  return materialDefinition({
    id: 'production-filter',
    kind: 'visual-filter',
    display: { name: 'Production Filter' },
  })
    .graph('graphs/production-filter.graph.json', graph)
    .build();
}

async function ecdsaKeyPair(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  if (!('privateKey' in pair)) throw new TypeError('Expected an asymmetric key pair');
  return pair;
}

describe('Material production trust and migration', () => {
  it('signs, verifies, installs and revokes an immutable package', async () => {
    const packed = await packMaterialPackage({ metadata, materials: [filterMaterial()] });
    const pair = await ecdsaKeyPair();
    const signed = await signMaterialPackage(packed, {
      publisherId: metadata.publisher.id,
      keyId: 'release-2026',
      algorithm: 'ECDSA-P256-SHA256',
      privateKey: pair.privateKey,
      signedAtMs: 1_000,
    });
    const trust = new MaterialTrustStore(8);
    trust.addKey(
      {
        publisherId: metadata.publisher.id,
        keyId: 'release-2026',
        algorithm: 'ECDSA-P256-SHA256',
        publicKey: pair.publicKey,
        validFromMs: 500,
        validUntilMs: 2_000,
      },
      900,
    );
    const registry = new MaterialRegistry();
    await expect(registry.installSigned(signed, trust, { nowMs: 1_500 })).resolves.toBeUndefined();
    expect(trust.auditLog().map(value => value.action)).toEqual(['key-added', 'verified']);

    trust.revokePackage(packed.integrity, 'publisher withdrawal', 1_600);
    await expect(trust.verify(signed, { nowMs: 1_700 })).rejects.toThrow(
      'MATERIAL_PACKAGE_REVOKED',
    );
    expect(trust.auditLog().at(-1)?.action).toBe('rejected');
  });

  it('rejects unsigned identity changes and host permission escalation', async () => {
    const packed = await packMaterialPackage({ metadata, materials: [filterMaterial()] });
    const pair = await ecdsaKeyPair();
    const signed = await signMaterialPackage(packed, {
      publisherId: metadata.publisher.id,
      keyId: 'key',
      algorithm: 'ECDSA-P256-SHA256',
      privateKey: pair.privateKey,
      signedAtMs: 10,
    });
    const trust = new MaterialTrustStore();
    trust.addKey({
      publisherId: metadata.publisher.id,
      keyId: 'key',
      algorithm: 'ECDSA-P256-SHA256',
      publicKey: pair.publicKey,
    });
    await expect(
      trust.verify(
        { ...signed, signature: { ...signed.signature, publisherId: 'attacker.example' } },
        { nowMs: 20 },
      ),
    ).rejects.toThrow('MATERIAL_SIGNATURE_IDENTITY_MISMATCH');

    expect(() =>
      enforceMaterialExecutionPolicy(
        'dev.example',
        {
          allowShader: true,
          allowWasm: false,
          allowedNetworkOrigins: ['https://assets.example'],
          maxMemoryBytes: 1024,
          maxExecutionMs: 10,
        },
        {
          trustedPublisherIds: new Set(['dev.example']),
          allowShader: false,
          allowWasm: false,
          allowedNetworkOrigins: new Set(['https://assets.example']),
          maxMemoryBytes: 2048,
          maxExecutionMs: 20,
        },
      ),
    ).toThrow('MATERIAL_SHADER_PERMISSION_DENIED');
  });

  it('chains deterministic migrations and rejects non-deterministic transforms', () => {
    const migrations = new MaterialMigrationRegistry();
    migrations.register({
      id: 'protocol-1-to-2',
      domain: 'protocol',
      from: '1',
      to: '2',
      migrate: value => ({ ...(value as Record<string, JsonValue>), protocol: 2 }),
    });
    migrations.register({
      id: 'protocol-2-to-3',
      domain: 'protocol',
      from: '2',
      to: '3',
      migrate: value => ({ ...(value as Record<string, JsonValue>), protocol: 3 }),
    });
    expect(migrations.migrate('protocol', '1', '3', { protocol: 1 })).toEqual({
      domain: 'protocol',
      from: '1',
      to: '3',
      migrationIds: ['protocol-1-to-2', 'protocol-2-to-3'],
      value: { protocol: 3 },
    });

    let invocation = 0;
    migrations.register({
      id: 'bad',
      domain: 'definition',
      from: '1',
      to: '2',
      migrate: () => ({ invocation: ++invocation }),
    });
    expect(() => migrations.migrate('definition', '1', '2', {})).toThrow(
      'MATERIAL_MIGRATION_NON_DETERMINISTIC',
    );
  });
});

describe('Material composition and catalog', () => {
  it('orders slots, fuses compatible graph passes and creates stable cache keys', async () => {
    const definition = filterMaterial().definition;
    const reference = {
      packageId: metadata.id,
      packageVersion: metadata.version,
      packageIntegrity: 'sha256:fixture',
      materialId: definition.id,
    };
    const slots: MaterialCompositionSlot[] = [
      { id: 'second', order: 2, enabled: true, reference, definition, parameters: { gain: 2 } },
      { id: 'first', order: 1, enabled: true, reference, definition, parameters: { gain: 1 } },
      { id: 'disabled', order: 0, enabled: false, reference, definition, parameters: {} },
    ];
    const first = await createMaterialCompositionPlan(slots, {
      outputWidth: 1920,
      outputHeight: 1080,
      workingColorSpace: 'srgb-linear',
    });
    const second = await createMaterialCompositionPlan(slots.slice().reverse(), {
      outputWidth: 1920,
      outputHeight: 1080,
      workingColorSpace: 'srgb-linear',
    });
    expect(first.slots.map(value => value.id)).toEqual(['first', 'second']);
    expect(first.fusionGroups).toEqual([{ slotIds: ['first', 'second'], fused: true }]);
    expect(first.cacheKey).toBe(second.cacheKey);
  });

  it('degrades promptly, recovers with hysteresis and enforces immutable catalog versions', () => {
    const quality = new AdaptiveMaterialQualityController({
      targetFrameMs: 16,
      recoveryFrames: 2,
    });
    expect(quality.reportFrame(40)).toBe(0.75);
    expect(quality.reportFrame(40)).toBe(0.5);
    for (let index = 0; index < 12; index++) quality.reportFrame(1);
    expect(quality.qualityScale).toBeGreaterThanOrEqual(0.75);

    const catalog = new MaterialCatalog();
    catalog.publish({
      packageId: metadata.id,
      packageVersion: metadata.version,
      packageIntegrity: 'sha256:a',
      publisherId: metadata.publisher.id,
      materialIds: ['production-filter'],
      publishedAtMs: 1,
    });
    expect(() =>
      catalog.publish({
        packageId: metadata.id,
        packageVersion: metadata.version,
        packageIntegrity: 'sha256:b',
        publisherId: metadata.publisher.id,
        materialIds: ['production-filter'],
        publishedAtMs: 2,
      }),
    ).toThrow('MATERIAL_CATALOG_VERSION_IMMUTABLE');
    catalog.setStatus(metadata.id, metadata.version, 'revoked', 'security issue');
    expect(() =>
      catalog.resolve({
        packageId: metadata.id,
        packageVersion: metadata.version,
        packageIntegrity: 'sha256:a',
        materialId: 'production-filter',
      }),
    ).toThrow('MATERIAL_CATALOG_REVOKED');
  });

  it('drives the headless Material Lab, backend budgets, Golden diff and package export', async () => {
    const authored = filterMaterial();
    const lab = new MaterialLabSession(authored);
    lab.setTime(500_000);
    lab.setInput('source', { fixture: 'gradient' });
    lab.recordGpuTiming(1_250);
    const report = lab.analyze();
    expect(report).toMatchObject({
      timeUs: 500_000,
      inputs: { source: { fixture: 'gradient' } },
      budget: { nodes: 1, passes: 1, textureSamples: 1 },
      webgl2: { available: true },
      webgpu: { available: true },
      gpuTimingsUs: [1_250],
    });
    expect(compareMaterialGolden(new Uint8Array([10, 20]), new Uint8Array([12, 21]), 2)).toEqual({
      passed: true,
      comparedValues: 2,
      differingValues: 0,
      maximumError: 2,
      meanError: 1.5,
    });
    await expect(lab.exportPackage(metadata)).resolves.toMatchObject({
      manifest: { package: { id: metadata.id } },
    });
  });
});
