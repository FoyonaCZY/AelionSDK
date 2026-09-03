// Prints a vitest bench JSON report as a flat table, and diffs it against a
// previously saved report when one is given.
import { readFileSync } from 'node:fs';

function rows(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const out = [];
  for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
      const scope = (group.fullName ?? '').split(' > ').slice(1).join(' > ');
      for (const entry of group.benchmarks ?? []) {
        out.push({ name: `${scope} › ${entry.name}`, mean: entry.mean });
      }
    }
  }
  return out;
}

const current = rows(process.argv[2]);
const baseline =
  process.argv[3] === undefined ? null : new Map(rows(process.argv[3]).map(r => [r.name, r.mean]));

const width = Math.max(8, ...current.map(row => row.name.length));
console.log(
  `${'scenario'.padEnd(width)}    mean ms${baseline ? '    baseline        change' : ''}`,
);
console.log('-'.repeat(width + (baseline ? 38 : 12)));
for (const row of current) {
  const mean = row.mean.toFixed(3).padStart(10);
  if (baseline === null) {
    console.log(`${row.name.padEnd(width)} ${mean}`);
    continue;
  }
  const before = baseline.get(row.name);
  if (before === undefined) {
    console.log(`${row.name.padEnd(width)} ${mean}          -           new`);
    continue;
  }
  const factor = before / row.mean;
  const label = factor >= 1 ? `${factor.toFixed(2)}x faster` : `${(1 / factor).toFixed(2)}x SLOWER`;
  console.log(
    `${row.name.padEnd(width)} ${mean} ${before.toFixed(3).padStart(10)}  ${label.padStart(14)}`,
  );
}
