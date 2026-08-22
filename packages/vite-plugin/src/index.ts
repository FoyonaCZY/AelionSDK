import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

export * from './runtime-assets.js';

const virtualPrefix = '\0@aelionsdk/vite-plugin:runtime-asset:';
const publicPrefix = '/@aelionsdk/vite-plugin/runtime-assets';

type AelionPackageName = '@aelionsdk/audio' | '@aelionsdk/export' | '@aelionsdk/renderer-worker';

interface RuntimeAsset {
  readonly entryFile: string;
  readonly key: string;
  readonly packageName: AelionPackageName;
  readonly packageDistDirectory: string;
  readonly publicUrl: string;
  readonly referencePattern: RegExp;
  readonly virtualId: string;
}

/** Options for the official Aelion Vite integration. */
export interface AelionVitePluginOptions {
  /** Emit and serve both `@aelionsdk/audio` AudioWorklet entries. Defaults to true. */
  audioWorklets?: boolean;
  /** Emit and serve the `@aelionsdk/renderer-worker` module Worker. Defaults to true. */
  rendererWorker?: boolean;
  /** Emit and serve the `@aelionsdk/export` mux Worker. Defaults to true. */
  exportWorker?: boolean;
}

function normalizedModuleId(id: string): string {
  return id.split('?', 1)[0]?.replaceAll('\\', '/') ?? id.replaceAll('\\', '/');
}

function packageDistDirectory(packageName: AelionPackageName): string {
  return dirname(fileURLToPath(import.meta.resolve(packageName)));
}

function isPackageDistModule(id: string, asset: RuntimeAsset): boolean {
  const normalizedId = normalizedModuleId(id);
  const normalizedDirectory = asset.packageDistDirectory.replaceAll('\\', '/');
  return (
    normalizedId.startsWith(`${normalizedDirectory}/`) ||
    normalizedId.includes(`/node_modules/${asset.packageName}/dist/`)
  );
}

function createRuntimeAsset(
  packageName: AelionPackageName,
  packageDist: string,
  fileName: string,
): RuntimeAsset {
  const namespace =
    packageName === '@aelionsdk/audio'
      ? 'audio'
      : packageName === '@aelionsdk/export'
        ? 'export'
        : 'renderer-worker';
  const key = `${namespace}/${fileName}`;
  return {
    entryFile: resolve(packageDist, fileName),
    key,
    packageName,
    packageDistDirectory: packageDist,
    publicUrl: `${publicPrefix}/${key}`,
    referencePattern: new RegExp(
      String.raw`new URL\(\s*(['"])\.\/${fileName.replaceAll('.', String.raw`\.`)}\1\s*,\s*import\.meta\.url\s*\)`,
      'gu',
    ),
    virtualId: `${virtualPrefix}${key}`,
  };
}

/**
 * Adds the published Aelion Worker/AudioWorklet entry graphs to Vite builds and
 * exposes the same module entries through the Vite development server.
 */
export function aelion(options: AelionVitePluginOptions = {}): Plugin {
  const includeAudioWorklets = options.audioWorklets ?? true;
  const includeRendererWorker = options.rendererWorker ?? true;
  const includeExportWorker = options.exportWorker ?? true;
  const audioDist = includeAudioWorklets ? packageDistDirectory('@aelionsdk/audio') : undefined;
  const rendererDist = includeRendererWorker
    ? packageDistDirectory('@aelionsdk/renderer-worker')
    : undefined;
  const exportDist = includeExportWorker ? packageDistDirectory('@aelionsdk/export') : undefined;
  const assets = [
    ...(audioDist === undefined
      ? []
      : [
          createRuntimeAsset('@aelionsdk/audio', audioDist, 'pcm-player.worklet.js'),
          createRuntimeAsset('@aelionsdk/audio', audioDist, 'pcm-message-player.worklet.js'),
        ]),
    ...(rendererDist === undefined
      ? []
      : [createRuntimeAsset('@aelionsdk/renderer-worker', rendererDist, 'webgl2-worker.js')]),
    ...(exportDist === undefined
      ? []
      : [createRuntimeAsset('@aelionsdk/export', exportDist, 'mux-export-worker.js')]),
  ];
  const assetByVirtualId = new Map(assets.map(asset => [asset.virtualId, asset]));
  const assetByPublicUrl = new Map(assets.map(asset => [asset.publicUrl, asset]));
  const emittedReferences = new Map<string, string>();
  let command: 'build' | 'serve' | undefined;

  return {
    name: '@aelionsdk/vite-plugin',
    enforce: 'pre',
    config() {
      const excluded = [
        ...(includeAudioWorklets ? ['@aelionsdk/audio', '@aelionsdk/sdk'] : []),
        ...(includeRendererWorker ? ['@aelionsdk/renderer-worker', '@aelionsdk/sdk'] : []),
        ...(includeExportWorker ? ['@aelionsdk/export', '@aelionsdk/sdk'] : []),
      ];
      return {
        optimizeDeps: {
          exclude: [...new Set(excluded)],
        },
      };
    },
    configResolved(config) {
      command = config.command;
    },
    buildStart() {
      if (command !== 'build') return;
      for (const asset of assets) {
        emittedReferences.set(
          asset.key,
          this.emitFile({
            type: 'chunk',
            id: asset.virtualId,
            name: `aelion-${asset.key.replaceAll('/', '-')}`,
          }),
        );
      }
    },
    resolveId(source, importer) {
      if (assetByVirtualId.has(source)) return source;
      const publicAsset = assetByPublicUrl.get(source.split('?', 1)[0] ?? source);
      if (publicAsset !== undefined) return publicAsset.virtualId;
      if (importer?.startsWith(virtualPrefix) === true && source.startsWith('.')) {
        const importerAsset = assetByVirtualId.get(importer);
        if (importerAsset !== undefined) {
          return resolve(dirname(importerAsset.entryFile), source);
        }
      }
      return undefined;
    },
    async load(id) {
      const asset = assetByVirtualId.get(id);
      return asset === undefined ? undefined : readFile(asset.entryFile, 'utf8');
    },
    transform(source, id) {
      let transformed = source;
      let changed = false;
      for (const asset of assets) {
        if (!isPackageDistModule(id, asset)) continue;
        asset.referencePattern.lastIndex = 0;
        if (!asset.referencePattern.test(transformed)) continue;
        asset.referencePattern.lastIndex = 0;
        let replacement: string;
        if (command === 'serve') {
          // Vite 7 import analysis rewrites `new URL('/@aelion…', import.meta.url)`
          // into `/@fs/@aelion…`, which 404s. @vite-ignore keeps the public module URL.
          replacement = `new URL(/* @vite-ignore */ ${JSON.stringify(asset.publicUrl)}, import.meta.url)`;
        } else {
          const referenceId = emittedReferences.get(asset.key);
          if (referenceId === undefined) {
            this.error(`Aelion runtime asset ${asset.key} was not emitted before transform`);
          }
          replacement = `new URL(import.meta.ROLLUP_FILE_URL_${referenceId}, import.meta.url)`;
        }
        transformed = transformed.replace(asset.referencePattern, replacement);
        changed = true;
      }
      return changed ? { code: transformed, map: null } : undefined;
    },
  };
}

export default aelion;
