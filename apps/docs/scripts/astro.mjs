import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ASTRO_TELEMETRY_DISABLED = '1';

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await Promise.all([
  rm(resolve(docsRoot, '.astro'), { recursive: true, force: true }),
  rm(resolve(docsRoot, 'node_modules/.astro'), { recursive: true, force: true }),
  rm(resolve(docsRoot, 'src/content/docs/api'), { recursive: true, force: true }),
]);

await import('../node_modules/astro/astro.js');
