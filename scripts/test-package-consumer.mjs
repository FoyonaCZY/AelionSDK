import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import { chromium, firefox } from 'playwright';

import { validateTarballConsumer } from './phase-1-evidence-lib.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDirectory = join(root, 'packages');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'aelion-package-smoke-'));
const tarballDirectory = join(temporaryDirectory, 'tarballs');
const consumerDirectory = join(temporaryDirectory, 'consumer');
const browserMode = process.argv.includes('--browser');
const evidencePath = join(root, 'reports', 'baseline', 'tarball-consumer.json');
const keepTemporaryDirectory = process.env.AELION_KEEP_CONSUMER_TEMP === '1';
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const packageManager = rootManifest.packageManager;
if (typeof packageManager !== 'string' || !/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager)) {
  throw new Error('Root package.json must pin an exact pnpm packageManager version');
}

async function run(command, args, cwd) {
  return execFileAsync(command, args, {
    cwd,
    env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function walk(directory) {
  const entries = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) entries.push(...(await walk(path)));
    else entries.push(path);
  }
  return entries;
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function normalizedBuildPath(path) {
  return relative(consumerDirectory, path).split(sep).join('/');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

async function packageContractHash(packageRoot) {
  const files = (await walk(join(packageRoot, 'dist')))
    .filter(path => path.endsWith('.d.ts'))
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(`${normalizedBuildPath(path)}\0`);
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function inspectRuntimeAssets(distDirectory) {
  const assetsDirectory = join(distDirectory, 'assets');
  const expectedAssets = [
    {
      id: 'pcm-player-worklet',
      marker: 'aelion-audio-pcm-player.worklet.js',
    },
    {
      id: 'pcm-message-player-worklet',
      marker: 'aelion-audio-pcm-message-player.worklet.js',
    },
    {
      id: 'webgl2-worker',
      marker: 'aelion-renderer-worker-webgl2-worker.js',
    },
  ];
  const files = await walk(distDirectory);
  const applicationSources = await Promise.all(
    files.filter(path => path.endsWith('.js')).map(path => readFile(path, 'utf8')),
  );
  const applicationSource = applicationSources.join('\n');
  for (const sourceReference of [
    './pcm-player.worklet.js',
    './pcm-message-player.worklet.js',
    './webgl2-worker.js',
  ]) {
    if (applicationSource.includes(sourceReference)) {
      throw new Error(`Production build retained source-relative runtime URL ${sourceReference}`);
    }
  }
  const runtimeAssets = [];
  for (const expected of expectedAssets) {
    const matches = (await readdir(assetsDirectory)).filter(
      name => name.includes(expected.marker) && name.endsWith('.js'),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected one ${expected.id} production chunk, found ${matches.length.toString()}`,
      );
    }
    const fileName = matches[0];
    const path = join(assetsDirectory, fileName);
    const source = await readFile(path, 'utf8');
    if (source.length < 100 || /<!doctype html|<html[\s>]/iu.test(source)) {
      throw new Error(`${expected.id} production asset is not JavaScript`);
    }
    const publicUrl = `/assets/${fileName}`;
    if (!applicationSource.includes(fileName)) {
      throw new Error(`${expected.id} URL ${publicUrl} is not referenced by the production build`);
    }
    runtimeAssets.push({
      id: expected.id,
      publicUrl,
      file: `dist/${relative(distDirectory, path).split(sep).join('/')}`,
      bytes: Buffer.byteLength(source),
      sha256: await sha256(path),
    });
  }
  return runtimeAssets;
}

async function localThirdPartyTarballs() {
  const packageRoots = [
    {
      name: '@types/node',
      from: root,
    },
    {
      name: 'typescript',
      from: root,
    },
    {
      name: 'vite',
      from: join(packagesDirectory, 'vite-plugin'),
    },
  ];
  for (const packageDirectory of await readdir(packagesDirectory)) {
    try {
      const manifest = JSON.parse(
        await readFile(join(packagesDirectory, packageDirectory, 'package.json'), 'utf8'),
      );
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        if (!name.startsWith('@aelion/') && !String(version).startsWith('workspace:')) {
          packageRoots.push({ name, from: join(packagesDirectory, packageDirectory) });
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async function resolveInstalledPackage(name, from) {
    try {
      return await realpath(join(from, 'node_modules', ...name.split('/')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const dependentRequire = createRequire(join(from, 'package.json'));
    try {
      return dirname(dependentRequire.resolve(`${name}/package.json`));
    } catch (error) {
      if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      const entry = dependentRequire.resolve(name);
      let current = dirname(entry);
      while (current !== dirname(current)) {
        try {
          const candidate = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
          if (candidate.name === name) return current;
        } catch (manifestError) {
          if (manifestError?.code !== 'ENOENT') throw manifestError;
        }
        current = dirname(current);
      }
      throw new Error(`Unable to locate installed package root for ${name}`);
    }
  }

  const packages = new Map();
  const hostOptionalPackages = new Set([
    `@esbuild/${process.platform}-${process.arch}`,
    `@rollup/rollup-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`,
  ]);
  async function collect(name, from, optional = false, includeOptionalDependencies = false) {
    let installedDirectory;
    try {
      installedDirectory = await resolveInstalledPackage(name, from);
    } catch (error) {
      if (optional && (error?.code === 'ENOENT' || error?.code === 'MODULE_NOT_FOUND')) return;
      throw error;
    }
    const manifest = JSON.parse(await readFile(join(installedDirectory, 'package.json'), 'utf8'));
    const existing = packages.get(name);
    if (existing !== undefined) {
      if (existing.manifest.version !== manifest.version) {
        throw new Error(
          `Offline consumer fixture cannot flatten ${name} versions ${existing.manifest.version} and ${manifest.version}`,
        );
      }
      return;
    }
    packages.set(name, { directory: installedDirectory, manifest });
    for (const dependencyName of Object.keys(manifest.dependencies ?? {}).sort()) {
      await collect(dependencyName, installedDirectory, false, includeOptionalDependencies);
    }
    if (includeOptionalDependencies) {
      for (const dependencyName of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
        if (hostOptionalPackages.has(dependencyName) || dependencyName === 'fsevents') {
          await collect(dependencyName, installedDirectory, true, true);
        }
      }
    }
  }

  for (const entry of packageRoots) {
    await collect(entry.name, entry.from, false, entry.name === 'vite');
  }

  const tarballs = {};
  for (const [name, entry] of [...packages].sort(([left], [right]) => left.localeCompare(right))) {
    const packed = await run(
      'corepack',
      [
        'pnpm',
        '--config.ignore-scripts=true',
        '--dir',
        entry.directory,
        'pack',
        '--pack-destination',
        tarballDirectory,
      ],
      root,
    );
    const tarballPath = `${packed.stdout}\n${packed.stderr}`
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(line => line.endsWith('.tgz'));
    if (tarballPath === undefined) throw new Error(`No tarball emitted for ${name}`);
    tarballs[name] = `file:${resolve(root, tarballPath)}`;
  }
  return tarballs;
}

async function runBrowserConsumer() {
  const fixtureDirectory = join(root, 'scripts', 'fixtures', 'package-consumer');
  for (const name of await readdir(fixtureDirectory)) {
    const targetName = name === 'main.mjs' ? 'main.js' : name;
    await cp(join(fixtureDirectory, name), join(consumerDirectory, targetName), {
      recursive: true,
    });
  }

  const canonicalConsumerDirectory = await realpath(consumerDirectory);
  const esbuildPackageRoot = await realpath(
    join(canonicalConsumerDirectory, 'node_modules', 'esbuild'),
  );
  const esbuildRequire = createRequire(join(esbuildPackageRoot, 'package.json'));
  const esbuildBinaryPath = esbuildRequire.resolve(
    `@esbuild/${process.platform}-${process.arch}/bin/esbuild`,
  );
  // Repacking the already-installed platform package with pnpm loses the
  // native binary's executable bit. Restore it only in this script-disabled,
  // hermetic fixture before Vite starts esbuild.
  await chmod(esbuildBinaryPath, 0o755);
  const browserConsumerEnvironment = {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ESBUILD_BINARY_PATH: esbuildBinaryPath,
  };
  const viteConfigPath = join(canonicalConsumerDirectory, 'vite.config.mjs');
  await writeFile(
    viteConfigPath,
    `import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
`,
  );
  await execFileAsync(
    process.execPath,
    [
      join(canonicalConsumerDirectory, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--config',
      viteConfigPath,
      '--logLevel',
      'error',
    ],
    {
      cwd: canonicalConsumerDirectory,
      env: browserConsumerEnvironment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const runtimeAssets = await inspectRuntimeAssets(join(canonicalConsumerDirectory, 'dist'));
  const installedVite = await import(
    pathToFileURL(
      join(canonicalConsumerDirectory, 'node_modules', 'vite', 'dist', 'node', 'index.js'),
    ).href
  );
  const previousEsbuildBinaryPath = process.env.ESBUILD_BINARY_PATH;
  process.env.ESBUILD_BINARY_PATH = esbuildBinaryPath;
  let server;
  try {
    server = await installedVite.preview({
      root: canonicalConsumerDirectory,
      configFile: viteConfigPath,
      logLevel: 'error',
      preview: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        headers: {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      },
    });
  } finally {
    if (previousEsbuildBinaryPath === undefined) delete process.env.ESBUILD_BINARY_PATH;
    else process.env.ESBUILD_BINARY_PATH = previousEsbuildBinaryPath;
  }
  const browserRuns = [
    {
      name: 'chromium',
      type: chromium,
      launch: {
        args: ['--autoplay-policy=no-user-gesture-required'],
        channel: 'chrome',
        headless: true,
      },
    },
    {
      name: 'firefox',
      type: firefox,
      launch: {
        firefoxUserPrefs: {
          'media.autoplay.default': 0,
          'media.autoplay.blocking_policy': 0,
          'media.cubeb.backend': 'null',
        },
        headless: true,
      },
    },
  ];
  try {
    const address = server.httpServer.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite consumer server did not expose a TCP address');
    }
    const url = `http://127.0.0.1:${address.port.toString()}/`;
    for (const asset of runtimeAssets) {
      const response = await fetch(`${url.slice(0, -1)}${asset.publicUrl}`);
      if (response.status !== 200) {
        throw new Error(`${asset.id} returned HTTP ${response.status.toString()}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const source = await response.text();
      if (!contentType.includes('javascript') || /<!doctype html|<html[\s>]/iu.test(source)) {
        throw new Error(`${asset.id} URL did not serve JavaScript (${contentType})`);
      }
    }
    const reports = [];
    for (const runDefinition of browserRuns) {
      let browser;
      try {
        browser = await runDefinition.type.launch(runDefinition.launch);
      } catch (error) {
        throw new Error(
          `Unable to launch ${runDefinition.name} for the tarball consumer: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      try {
        const page = await browser.newPage();
        const pageErrors = [];
        const failedRequests = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('requestfailed', request => {
          failedRequests.push(
            `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`,
          );
        });
        await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
        await page.waitForFunction(
          () => globalThis.__AELION_TARBALL_CONSUMER__?.status !== 'running',
          undefined,
          { timeout: 20_000 },
        );
        const report = await page.evaluate(() => globalThis.__AELION_TARBALL_CONSUMER__);
        if (report?.status !== 'passed') {
          throw new Error(
            `${runDefinition.name} consumer failed: ${JSON.stringify(report)}; page errors: ${JSON.stringify(pageErrors)}; failed requests: ${JSON.stringify(failedRequests)}`,
          );
        }
        if (pageErrors.length > 0 || failedRequests.length > 0) {
          throw new Error(
            `${runDefinition.name} consumer emitted browser errors: ${JSON.stringify({ pageErrors, failedRequests })}`,
          );
        }
        reports.push({ browser: runDefinition.name, report: report.result });
      } finally {
        await browser.close();
      }
    }
    process.stdout.write(`Tarball browser consumer passed:\n${JSON.stringify(reports, null, 2)}\n`);
    return {
      browsers: reports,
      runtimeAssets,
      viteConfigSha256: await sha256(viteConfigPath),
    };
  } finally {
    await server.close();
  }
}

try {
  await mkdir(tarballDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });
  const publicPackages = [];
  for (const directoryName of (await readdir(packagesDirectory)).sort()) {
    const packageDirectory = join(packagesDirectory, directoryName);
    const manifestPath = join(packageDirectory, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.private !== true && manifest.name?.startsWith('@aelion/')) {
        publicPackages.push({ directory: packageDirectory, manifest });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (publicPackages.length === 0) throw new Error('No public @aelion packages found');
  if (!publicPackages.some(entry => entry.manifest.name === '@aelion/sdk')) {
    throw new Error('@aelion/sdk must be part of the public package set');
  }
  if (!publicPackages.some(entry => entry.manifest.name === '@aelion/vite-plugin')) {
    throw new Error('@aelion/vite-plugin must be part of the public package set');
  }

  const tarballs = [];
  for (const entry of publicPackages) {
    const result = await run(
      'corepack',
      ['pnpm', 'pack', '--pack-destination', tarballDirectory],
      entry.directory,
    );
    const output = `${result.stdout}\n${result.stderr}`;
    const tarballPath = output
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(line => line.endsWith('.tgz'));
    if (tarballPath === undefined) throw new Error(`No tarball emitted for ${entry.manifest.name}`);
    tarballs.push(resolve(entry.directory, tarballPath));
  }
  const packedPackages = await Promise.all(
    publicPackages.map(async (entry, index) => ({
      name: entry.manifest.name,
      version: entry.manifest.version,
      sha256: await sha256(tarballs[index]),
    })),
  );

  const dependencies = Object.fromEntries(
    publicPackages.map((entry, index) => [entry.manifest.name, `file:${tarballs[index]}`]),
  );
  const thirdPartyTarballs = await localThirdPartyTarballs();
  const consumerDependencies = { ...dependencies, ...thirdPartyTarballs };
  const consumerDependencyContract = Object.fromEntries(
    Object.entries(consumerDependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, specifier]) => [
        name,
        specifier.startsWith('file:') ? specifier.slice(specifier.lastIndexOf('/') + 1) : specifier,
      ]),
  );
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'aelion-package-consumer-smoke',
        private: true,
        type: 'module',
        packageManager,
        dependencies: consumerDependencies,
        pnpm: { overrides: { ...dependencies, ...thirdPartyTarballs } },
      },
      null,
      2,
    )}\n`,
  );
  await run(
    'corepack',
    ['pnpm', 'install', '--offline', '--ignore-scripts', '--lockfile=false'],
    consumerDirectory,
  );

  const checks = [];
  for (const { manifest } of publicPackages) {
    const packageRoot = join(consumerDirectory, 'node_modules', ...manifest.name.split('/'));
    const installedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (installedManifest.version !== manifest.version) {
      throw new Error(`${manifest.name} installed with unexpected version`);
    }
    if (installedManifest.private === true || installedManifest.license !== 'MIT') {
      throw new Error(`${manifest.name} is not publishable under MIT`);
    }
    if (
      Object.values(installedManifest.dependencies ?? {}).some(version =>
        String(version).startsWith('workspace:'),
      )
    ) {
      throw new Error(`${manifest.name} tarball still contains workspace dependency ranges`);
    }
    for (const required of ['LICENSE', 'README.md', 'dist/index.js', 'dist/index.d.ts']) {
      await stat(join(packageRoot, required));
    }
    const files = await walk(packageRoot);
    if (files.some(file => file.endsWith('.tsbuildinfo') || /\/src\//u.test(file))) {
      throw new Error(`${manifest.name} contains internal build/source files`);
    }
    for (const file of files.filter(path => path.endsWith('.js'))) {
      const source = await readFile(file, 'utf8');
      const references = source.matchAll(/new URL\(['"](\.\/[^'"]+)['"],\s*import\.meta\.url\)/gu);
      for (const match of references) {
        const target = resolve(dirname(file), match[1]);
        await stat(target);
        if (target.endsWith('.ts'))
          throw new Error(`${file} references TypeScript asset ${target}`);
      }
    }
    checks.push(manifest.name);
  }
  await writeFile(
    join(consumerDirectory, 'smoke.mjs'),
    `${checks.map(name => `await import(${JSON.stringify(name)});`).join('\n')}\n`,
  );
  await run(process.execPath, ['smoke.mjs'], consumerDirectory);
  await writeFile(
    join(consumerDirectory, 'contract.ts'),
    `import { Aelion, type AelionSessionOptions } from '@aelion/sdk';
import { aelion, type AelionVitePluginOptions } from '@aelion/vite-plugin';
import { defineConfig, type UserConfig } from 'vite';

const pluginOptions = { audioWorklets: true, rendererWorker: true } satisfies AelionVitePluginOptions;
const config = defineConfig({ plugins: [aelion(pluginOptions)] });
const sessionOptions = { preferredBackend: 'webgl2' } satisfies AelionSessionOptions;
const session = await Aelion.createSession(sessionOptions);
await session.dispose();
export const contract: UserConfig = config;
`,
  );
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2023',
          types: ['node'],
          verbatimModuleSyntax: true,
        },
        include: ['contract.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await run(
    process.execPath,
    [join(consumerDirectory, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
    consumerDirectory,
  );
  process.stdout.write(`Package consumer smoke passed: ${checks.join(', ')}\n`);
  if (browserMode) {
    const browserConsumer = await runBrowserConsumer();
    const consumerManifestPath = join(consumerDirectory, 'package.json');
    const consumerContractPath = join(consumerDirectory, 'contract.ts');
    const consumerTsconfigPath = join(consumerDirectory, 'tsconfig.json');
    const pluginPackage = packedPackages.find(entry => entry.name === '@aelion/vite-plugin');
    const pluginRoot = join(consumerDirectory, 'node_modules', '@aelion', 'vite-plugin');
    const evidence = {
      schemaVersion: '1.0.0',
      sdkVersion: packedPackages.find(entry => entry.name === '@aelion/sdk')?.version ?? 'unknown',
      generatedAt: new Date().toISOString(),
      command: 'corepack pnpm test:consumer',
      bundlerAdapter: {
        id: '@aelion/vite-plugin',
        package: '@aelion/vite-plugin',
        version: pluginPackage?.version ?? 'unknown',
        packageSha256: pluginPackage?.sha256 ?? 'unknown',
        contractSha256: await packageContractHash(pluginRoot),
        public: true,
        zeroConfigVite: false,
        configuration: "import { aelion } from '@aelion/vite-plugin'; plugins: [aelion()]",
        viteConfigSha256: browserConsumer.viteConfigSha256,
        note: 'The consumer imports the explicit, versioned Vite plugin from its installed npm tarball. No repository path aliases or private test transforms are used.',
      },
      consumerContract: {
        typecheck: 'node node_modules/typescript/bin/tsc --noEmit',
        dependencyContractSha256: hashValue(consumerDependencyContract),
        dependencyContract: consumerDependencyContract,
        packageJsonSha256: await sha256(consumerManifestPath),
        sourceSha256: await sha256(consumerContractPath),
        tsconfigSha256: await sha256(consumerTsconfigPath),
      },
      packages: packedPackages,
      runtimeAssets: browserConsumer.runtimeAssets,
      browsers: browserConsumer.browsers,
    };
    const validation = validateTarballConsumer(evidence, evidence.sdkVersion);
    if (!validation.passed) {
      throw new Error(
        `Tarball consumer evidence contract failed: ${validation.reasons.join('; ')}`,
      );
    }
    await mkdir(dirname(evidencePath), { recursive: true });
    const pendingEvidencePath = `${evidencePath}.${process.pid.toString()}.tmp`;
    await writeFile(pendingEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await rename(pendingEvidencePath, evidencePath);
    process.stdout.write(
      `Wrote tarball consumer evidence to reports/baseline/tarball-consumer.json\n`,
    );
  }
} finally {
  if (keepTemporaryDirectory) {
    process.stderr.write(`Preserved consumer fixture at ${temporaryDirectory}\n`);
  } else {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
