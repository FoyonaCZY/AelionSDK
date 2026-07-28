import { readFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type AelionPackageName = '@aelionsdk/audio' | '@aelionsdk/export' | '@aelionsdk/renderer-worker';

interface RuntimeAssetSpec {
  readonly key: keyof AelionRuntimeAssetUrls;
  readonly packageName: AelionPackageName;
  readonly fileName: string;
  readonly directory: string;
}

export interface AelionRuntimeAssetUrls {
  readonly rendererWorker: string;
  readonly exportWorker: string;
  readonly sharedAudioWorklet: string;
  readonly transferableAudioWorklet: string;
}

export interface AelionRuntimeAssetFile {
  readonly key: keyof AelionRuntimeAssetUrls;
  readonly outputPath: string;
  readonly bytes: Uint8Array;
}

export interface AelionWebpackPluginOptions {
  /** Emitted directory inside the bundler output. Defaults to `aelion`. */
  readonly outputDirectory?: string;
}

interface CompilationLike {
  readonly hooks: {
    readonly processAssets: {
      tapPromise(
        options: { readonly name: string; readonly stage: number },
        callback: () => Promise<void>,
      ): void;
    };
  };
  emitAsset(name: string, source: unknown): void;
}

interface CompilerLike {
  readonly webpack: {
    readonly Compilation: { readonly PROCESS_ASSETS_STAGE_ADDITIONAL: number };
    readonly sources: {
      readonly RawSource: new (bytes: Uint8Array) => unknown;
    };
  };
  readonly hooks: {
    readonly thisCompilation: {
      tap(name: string, callback: (compilation: CompilationLike) => void): void;
    };
  };
}

function packageDistDirectory(packageName: AelionPackageName): string {
  return dirname(fileURLToPath(import.meta.resolve(packageName)));
}

function specifications(outputDirectory: string): readonly RuntimeAssetSpec[] {
  return [
    {
      key: 'sharedAudioWorklet',
      packageName: '@aelionsdk/audio',
      fileName: 'pcm-player.worklet.js',
      directory: posix.join(outputDirectory, 'audio'),
    },
    {
      key: 'transferableAudioWorklet',
      packageName: '@aelionsdk/audio',
      fileName: 'pcm-message-player.worklet.js',
      directory: posix.join(outputDirectory, 'audio'),
    },
    {
      key: 'rendererWorker',
      packageName: '@aelionsdk/renderer-worker',
      fileName: 'webgl2-worker.js',
      directory: posix.join(outputDirectory, 'renderer-worker'),
    },
    {
      key: 'exportWorker',
      packageName: '@aelionsdk/export',
      fileName: 'mux-export-worker.js',
      directory: posix.join(outputDirectory, 'export'),
    },
  ];
}

function normalizedDirectory(value: string): string {
  const result = value.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
  if (result.length === 0 || result.split('/').some(part => part === '.' || part === '..')) {
    throw new TypeError('outputDirectory must be a safe relative path');
  }
  return result;
}

function baseUrl(value: string): string {
  return `${value.replace(/\/+$/gu, '')}/`;
}

/** Explicit URLs for ESM/CDN/Next.js clients that serve the four runtime entries themselves. */
export function aelionRuntimeAssetUrls(
  publicBase = '/aelion/',
  outputDirectory = 'aelion',
): AelionRuntimeAssetUrls {
  const prefix = baseUrl(publicBase);
  const entries = specifications(normalizedDirectory(outputDirectory)).map(specification => [
    specification.key,
    `${prefix}${specification.directory}/${specification.fileName}`,
  ]);
  return Object.freeze(Object.fromEntries(entries) as unknown as AelionRuntimeAssetUrls);
}

/** Reads the built package entries for custom copy pipelines and non-Webpack bundlers. */
export async function loadAelionRuntimeAssets(
  outputDirectory = 'aelion',
): Promise<readonly AelionRuntimeAssetFile[]> {
  const files = await Promise.all(
    specifications(normalizedDirectory(outputDirectory)).map(async specification => ({
      key: specification.key,
      outputPath: posix.join(specification.directory, specification.fileName),
      bytes: new Uint8Array(
        await readFile(
          resolve(packageDistDirectory(specification.packageName), specification.fileName),
        ),
      ),
    })),
  );
  return Object.freeze(files);
}

/**
 * Webpack 5/Rspack adapter. It emits the same stable asset layout used by
 * `AelionSessionOptions.runtimeAssets`; applications pass `runtimeAssets()`
 * from a client-only module.
 */
export class AelionWebpackPlugin {
  readonly #outputDirectory: string;

  public constructor(options: AelionWebpackPluginOptions = {}) {
    this.#outputDirectory = normalizedDirectory(options.outputDirectory ?? 'aelion');
  }

  public runtimeAssets(publicBase = '/'): AelionRuntimeAssetUrls {
    return aelionRuntimeAssetUrls(publicBase, this.#outputDirectory);
  }

  public apply(compiler: CompilerLike): void {
    const pluginName = '@aelionsdk/webpack-plugin';
    compiler.hooks.thisCompilation.tap(pluginName, compilation => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: pluginName,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        async () => {
          for (const asset of await loadAelionRuntimeAssets(this.#outputDirectory)) {
            compilation.emitAsset(
              asset.outputPath,
              new compiler.webpack.sources.RawSource(asset.bytes),
            );
          }
        },
      );
    });
  }
}
