import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RELEASE_LOCKFILE_INSTALL_ARGS,
  RELEASE_VERSION_DOCUMENTS,
  updateDocumentVersion,
  updateManifestVersion,
} from './release-version-lib.mjs';

test('version updates can intentionally refresh a frozen workspace lockfile', () => {
  assert.deepEqual(RELEASE_LOCKFILE_INSTALL_ARGS, [
    'pnpm',
    'install',
    '--lockfile-only',
    '--no-frozen-lockfile',
    '--ignore-scripts',
  ]);
});

test('manifest updates exact public package pins and preserves workspace links', () => {
  const source = {
    name: '@aelionsdk/example',
    version: '0.1.0-beta.1',
    dependencies: {
      '@aelionsdk/core': '0.1.0-beta.1',
      '@aelionsdk/local-app': 'workspace:*',
      ajv: '8.18.0',
    },
  };
  const updated = updateManifestVersion(source, '0.1.0-beta.1', '0.1.0-beta.2');
  assert.equal(updated.version, '0.1.0-beta.2');
  assert.equal(updated.dependencies['@aelionsdk/core'], '0.1.0-beta.2');
  assert.equal(updated.dependencies['@aelionsdk/local-app'], 'workspace:*');
  assert.equal(updated.dependencies.ajv, '8.18.0');
  assert.equal(source.version, '0.1.0-beta.1');
});

test('manifest update fails closed on an independently drifted package pin', () => {
  assert.throws(
    () =>
      updateManifestVersion(
        {
          name: '@aelionsdk/example',
          version: '0.1.0-beta.1',
          dependencies: { '@aelionsdk/core': '^0.1.0' },
        },
        '0.1.0-beta.1',
        '0.1.0-beta.2',
      ),
    /must pin/u,
  );
});

test('curated release documents replace every current-version occurrence', () => {
  assert.equal(
    updateDocumentVersion(
      'Install 0.1.0-beta.1; tag v0.1.0-beta.1.',
      '0.1.0-beta.1',
      '0.1.0-beta.2',
      'README.md',
    ),
    'Install 0.1.0-beta.2; tag v0.1.0-beta.2.',
  );
  assert.throws(
    () => updateDocumentVersion('no version', '0.1.0-beta.1', '0.1.0-beta.2', 'README.md'),
    /does not contain/u,
  );
  assert.ok(RELEASE_VERSION_DOCUMENTS.includes('packages/sdk/api-snapshot.md'));
  assert.ok(RELEASE_VERSION_DOCUMENTS.includes('packages/material-sdk/README.md'));
  assert.ok(RELEASE_VERSION_DOCUMENTS.includes('compatibility/device-matrix.json'));
  assert.ok(RELEASE_VERSION_DOCUMENTS.includes('README.zh-CN.md'));
  assert.ok(RELEASE_VERSION_DOCUMENTS.includes('apps/docs/src/content/docs/project/status.md'));
  for (const packageName of [
    'audio',
    'capability',
    'core',
    'export',
    'material-compiler',
    'media',
    'project-schema',
    'renderer-worker',
    'render-ir',
    'sdk',
    'transaction',
    'vite-plugin',
  ]) {
    assert.ok(RELEASE_VERSION_DOCUMENTS.includes(`packages/${packageName}/README.md`));
  }
  assert.ok(!RELEASE_VERSION_DOCUMENTS.includes('CHANGELOG.md'));
});
