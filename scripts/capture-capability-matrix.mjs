#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'reports', 'baseline');
const server = await createServer({
  configFile: resolve(root, 'apps', 'capability-lab', 'vite.config.ts'),
  server: { port: 4174, strictPort: true },
});
const engines = [
  { id: 'chromium', type: chromium, launch: { channel: 'chrome', headless: true } },
  { id: 'firefox', type: firefox, launch: { headless: true } },
  { id: 'webkit', type: webkit, launch: { headless: true } },
];

await mkdir(outputDirectory, { recursive: true });
try {
  await server.listen();
  for (const engine of engines) {
    let browser;
    try {
      browser = await engine.type.launch(engine.launch);
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Reflect.has(globalThis, '__AELION_CAPABILITY_REPORT__'));
      const report = await page.evaluate(() =>
        Reflect.get(globalThis, '__AELION_CAPABILITY_REPORT__'),
      );
      const evidence = {
        evidenceVersion: '1.0.0',
        command: 'pnpm report:capability:matrix',
        engine: engine.id,
        report,
      };
      await writeFile(
        resolve(outputDirectory, `capability-${engine.id}.json`),
        JSON.stringify(evidence, null, 2) + '\n',
      );
      console.log(`Wrote capability-${engine.id}.json`);
    } catch (cause) {
      const evidence = {
        evidenceVersion: '1.0.0',
        command: 'pnpm report:capability:matrix',
        engine: engine.id,
        blocked: true,
        diagnostic: {
          code: 'COMPATIBILITY_RUNTIME_BLOCKED',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };
      await writeFile(
        resolve(outputDirectory, `capability-${engine.id}.json`),
        JSON.stringify(evidence, null, 2) + '\n',
      );
      console.warn(`Recorded blocked ${engine.id} capability run`);
    } finally {
      await browser?.close();
    }
  }
} finally {
  await server.close();
}
