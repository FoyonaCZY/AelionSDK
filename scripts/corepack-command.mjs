import { dirname, join } from 'node:path';

export const corepackExecutable = process.platform === 'win32' ? process.execPath : 'corepack';

const corepackEntrypoint =
  process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
    : undefined;

export function corepackArguments(args) {
  return corepackEntrypoint === undefined ? args : [corepackEntrypoint, ...args];
}
