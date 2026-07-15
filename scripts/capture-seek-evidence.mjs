#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import { captureBrowserIdentity, publishValidatedJson } from './evidence-runtime.mjs';
import { validateSeekEvidence } from './phase-1-evidence-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'reports', 'baseline', 'media-seek-chromium.json');
const server = await createServer({
  configFile: resolve(root, 'apps', 'evidence-runner', 'vite.config.ts'),
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4176/apps/evidence-runner/seek.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      Reflect.has(globalThis, '__AELION_SEEK_EVIDENCE__') ||
      Reflect.has(globalThis, '__AELION_SEEK_ERROR__'),
    undefined,
    { timeout: 120_000 },
  );
  const failure = await page.evaluate(() => Reflect.get(globalThis, '__AELION_SEEK_ERROR__'));
  if (failure !== undefined) throw new Error(JSON.stringify(failure));
  const evidence = await page.evaluate(() => Reflect.get(globalThis, '__AELION_SEEK_EVIDENCE__'));
  const browserIdentity = await captureBrowserIdentity(browser, page);
  const report = {
    ...evidence,
    command: 'corepack pnpm report:seek',
    generatedAt: new Date().toISOString(),
    browser: browserIdentity.browser,
    browserVersion: browserIdentity.browserVersion,
    userAgent: browserIdentity.userAgent,
  };
  await publishValidatedJson({ outputPath, document: report, validate: validateSeekEvidence });
  console.log('Wrote ' + outputPath);
} finally {
  await browser?.close();
  await server.close();
}
