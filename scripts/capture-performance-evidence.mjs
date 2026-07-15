#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import {
  captureBrowserIdentity,
  probeReferenceDevice,
  publishValidatedJson,
} from './evidence-runtime.mjs';
import { validatePerformanceEvidence } from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'reports', 'baseline', 'performance-1080p30-chromium.json');
const server = await createServer({
  configFile: resolve(root, 'apps', 'evidence-runner', 'vite.config.ts'),
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4176/apps/evidence-runner/performance.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      Reflect.has(globalThis, '__AELION_PERFORMANCE_EVIDENCE__') ||
      Reflect.has(globalThis, '__AELION_PERFORMANCE_ERROR__'),
    undefined,
    { timeout: 10 * 60_000 },
  );
  const failure = await page.evaluate(() =>
    Reflect.get(globalThis, '__AELION_PERFORMANCE_ERROR__'),
  );
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
  const evidence = await page.evaluate(() =>
    Reflect.get(globalThis, '__AELION_PERFORMANCE_EVIDENCE__'),
  );
  const [referenceDevice, browserIdentity] = await Promise.all([
    probeReferenceDevice(),
    captureBrowserIdentity(browser, page),
  ]);
  const report = {
    ...evidence,
    command: 'corepack pnpm report:performance',
    generatedAt: new Date().toISOString(),
    referenceDevice: {
      ...referenceDevice,
      ...browserIdentity,
    },
    browserVersion: browserIdentity.browserVersion,
    userAgent: browserIdentity.userAgent,
  };
  await publishValidatedJson({
    outputPath,
    document: report,
    validate: validatePerformanceEvidence,
  });
  console.log('Wrote ' + outputPath);
} finally {
  await browser?.close();
  await server.close();
}
