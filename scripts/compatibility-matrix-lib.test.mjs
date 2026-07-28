import assert from 'node:assert/strict';
import test from 'node:test';

import { compatibilityMatrixReasons } from './compatibility-matrix-lib.mjs';

function matrix() {
  return {
    schemaVersion: '1.0.0',
    sdkVersion: '0.2.0',
    policy: {
      runtimeProbeRequired: true,
      userAgentDecisionAllowed: false,
      blockedRunCountsAsPass: false,
    },
    environments: [{ id: 'device', status: 'uncertified', evidence: [] }],
    axes: [
      'codec-configurations',
      'containers',
      'gpu-webgl2',
      'gpu-webgpu',
      'audio-worklet',
      'opfs',
      'shared-array-buffer',
    ].map(id => ({
      id,
      status: 'tested',
      evidence: [`reports/baseline/${id}.json`],
    })),
  };
}

test('versioned compatibility matrix requires all product decision axes', () => {
  assert.deepEqual(compatibilityMatrixReasons(matrix(), '0.2.0'), []);
  const candidate = matrix();
  candidate.axes.pop();
  assert.match(
    compatibilityMatrixReasons(candidate, '0.2.0').join('\n'),
    /required axis shared-array-buffer is absent/u,
  );
});

test('matrix cannot claim tested without evidence or use unsafe evidence paths', () => {
  const candidate = matrix();
  candidate.environments[0].status = 'tested';
  candidate.axes[0].evidence = ['../forged.json'];
  const reasons = compatibilityMatrixReasons(candidate, '0.2.0');
  assert.ok(reasons.some(value => value.includes('cannot be tested without evidence')));
  assert.ok(reasons.some(value => value.includes('unsafe evidence path')));
});
