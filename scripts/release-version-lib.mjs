const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export const RELEASE_LOCKFILE_INSTALL_ARGS = Object.freeze([
  'pnpm',
  'install',
  '--lockfile-only',
  '--no-frozen-lockfile',
  '--ignore-scripts',
]);

export const RELEASE_VERSION_DOCUMENTS = Object.freeze([
  'README.md',
  'README.zh-CN.md',
  'apps/docs/src/content/docs/index.mdx',
  'apps/docs/src/content/docs/project/status.md',
  'apps/docs/src/content/docs/reference/packages.md',
  'apps/docs/src/content/docs/zh/index.mdx',
  'apps/docs/src/content/docs/zh/project/status.md',
  'apps/docs/src/content/docs/zh/reference/diagnostic-codes.md',
  'apps/docs/src/content/docs/zh/reference/packages.md',
  'apps/docs/src/content/docs/start/installation.md',
  'apps/docs/src/content/docs/start/packages.md',
  'apps/docs/src/content/docs/zh/start/installation.md',
  'apps/docs/src/content/docs/zh/start/packages.md',
  'compatibility/matrix.v1.json',
  'compatibility/device-matrix.json',
  'packages/audio/README.md',
  'packages/capability/README.md',
  'packages/core/README.md',
  'packages/export/README.md',
  'packages/material-compiler/README.md',
  'packages/material-sdk/README.md',
  'packages/media/README.md',
  'packages/project-schema/README.md',
  'packages/renderer-worker/README.md',
  'packages/render-ir/README.md',
  'packages/sdk/README.md',
  'packages/sdk/api-snapshot.md',
  'packages/transaction/README.md',
  'packages/vite-plugin/README.md',
]);

export function updateManifestVersion(manifest, currentVersion, nextVersion) {
  if (manifest.version !== currentVersion) {
    throw new Error(
      `${String(manifest.name)} version ${String(manifest.version)} differs from ${currentVersion}`,
    );
  }

  const updated = JSON.parse(JSON.stringify(manifest));
  updated.version = nextVersion;
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, range] of Object.entries(updated[section] ?? {})) {
      if (!name.startsWith('@aelionsdk/') || String(range).startsWith('workspace:')) continue;
      if (range !== currentVersion) {
        throw new Error(
          `${String(manifest.name)} ${section}.${name} must pin ${currentVersion}, received ${String(range)}`,
        );
      }
      updated[section][name] = nextVersion;
    }
  }
  return updated;
}

export function updateDocumentVersion(source, currentVersion, nextVersion, path) {
  if (!source.includes(currentVersion)) {
    throw new Error(`${path} does not contain the current release version ${currentVersion}`);
  }
  return source.replaceAll(currentVersion, nextVersion);
}
