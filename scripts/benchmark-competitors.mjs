import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const competitorNodeModulesArgument = argument(
  '--competitor-node-modules',
  process.env.AELION_COMPETITOR_NODE_MODULES,
);
if (competitorNodeModulesArgument === undefined || competitorNodeModulesArgument.length === 0) {
  throw new Error(
    'Pass --competitor-node-modules <directory> containing @webav/av-cliper@1.2.8 and @diffusionstudio/core@4.0.3',
  );
}
const competitorNodeModules = resolve(competitorNodeModulesArgument);
const output = resolve(
  argument('--output', resolve(root, 'reports/baseline/competitor-benchmark-chromium.json')),
);
const webavEntry = resolve(competitorNodeModules, '@webav/av-cliper/dist/av-cliper.js');
const diffusionEntry = resolve(competitorNodeModules, '@diffusionstudio/core/dist/core.es.js');
const packageJson = path => readFile(path, 'utf8').then(value => JSON.parse(value));

const aliases = Object.fromEntries(
  [
    'audio',
    'capability',
    'core',
    'export',
    'material-compiler',
    'media',
    'project-schema',
    'render-ir',
    'renderer-worker',
    'sdk',
    'transaction',
  ].map(name => [`@aelion/${name}`, resolve(root, `packages/${name}/src/index.ts`)]),
);

const server = await createViteServer({
  root,
  logLevel: 'error',
  resolve: {
    alias: {
      ...aliases,
      '@benchmark/webav': webavEntry,
      '@benchmark/diffusion': diffusionEntry,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
    fs: { allow: [root, competitorNodeModules] },
  },
  plugins: [
    {
      name: 'aelion-competitor-benchmark',
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== '/competitor-benchmark') return next();
          try {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            response.end(
              '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script type="module" src="/scripts/competitor-benchmark-entry.ts"></script>',
            );
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('Vite did not expose a benchmark URL');
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-features=Vulkan,UseSkiaRenderer',
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push(`${response.status().toString()} ${response.url()}`);
    }
  });
  const navigation = await page.goto(new URL('/competitor-benchmark', url).href);
  try {
    await page.waitForFunction(
      () => typeof globalThis.__runAelionCompetitorBenchmark === 'function',
      undefined,
      { timeout: 30_000 },
    );
  } catch (error) {
    process.stderr.write(
      `${navigation?.status().toString() ?? 'no-status'} ${page.url()}\n${errors.join('\n')}\n${await page.content()}\n`,
    );
    throw error;
  }
  const report = await page.evaluate(() => globalThis.__runAelionCompetitorBenchmark());
  const [aelionPackage, webavPackage, diffusionPackage] = await Promise.all([
    packageJson(resolve(root, 'packages/sdk/package.json')),
    packageJson(resolve(competitorNodeModules, '@webav/av-cliper/package.json')),
    packageJson(resolve(competitorNodeModules, '@diffusionstudio/core/package.json')),
  ]);
  report.versions = {
    '@aelion/sdk': aelionPackage.version,
    '@webav/av-cliper': webavPackage.version,
    '@diffusionstudio/core': diffusionPackage.version,
    chromium: browser.version(),
  };
  if (errors.length > 0) report.browserErrors = errors;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const aelion = report.results.find(result => result.engine === 'aelion');
  if (
    !process.argv.includes('--no-assert') &&
    (aelion === undefined || aelion.sequential.p95Ms > 33 || aelion.warmSeek.p95Ms > 150)
  ) {
    throw new Error('Aelion missed the competitor benchmark preview/seek release budget');
  }
  process.stdout.write(`${output}\n`);
} finally {
  await browser?.close();
  await server.close();
}
