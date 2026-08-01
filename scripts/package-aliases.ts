import { fileURLToPath } from 'node:url';

import baseTsconfig from '../tsconfig.base.json';

/**
 * Vite/Vitest alias 映射，由 tsconfig.base.json 的 compilerOptions.paths 派生。
 * 单一事实来源是 tsconfig.base.json：新增 @aelionsdk/* 包时只需更新那里。
 */
export function buildViteAliases(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(baseTsconfig.compilerOptions.paths).map(([name, candidates]) => {
      const rel = candidates[0];
      if (!rel) {
        throw new Error(`tsconfig.base.json path "${name}" must declare a target`);
      }
      return [name, fileURLToPath(new URL(`../${rel}`, import.meta.url))];
    }),
  );
}
