import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('scripts');
const files = (await readdir(directory))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => resolve(directory, name));

if (files.length === 0) throw new Error('No evidence script tests were found');

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal !== null) {
      reject(new Error(`Evidence tests terminated by ${signal}`));
      return;
    }
    resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
