#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'reports', 'baseline', 'capability-chromium.json');
const server = await createServer({
  configFile: resolve(root, 'apps', 'capability-lab', 'vite.config.ts'),
  server: { port: 4174, strictPort: true },
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Reflect.has(globalThis, '__AELION_CAPABILITY_REPORT__'));
  const report = await page.evaluate(() => Reflect.get(globalThis, '__AELION_CAPABILITY_REPORT__'));
  const evidence = {
    evidenceVersion: '1.0.0',
    command: 'pnpm report:capability',
    report,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log('Wrote ' + outputPath);
} finally {
  await browser?.close();
  await server.close();
}
