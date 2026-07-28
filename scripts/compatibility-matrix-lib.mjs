const STATUSES = new Set(['tested', 'capability-gated', 'unsupported', 'uncertified']);
const REQUIRED_AXES = new Set([
  'codec-configurations',
  'containers',
  'gpu-webgl2',
  'gpu-webgpu',
  'audio-worklet',
  'opfs',
  'shared-array-buffer',
]);

function validateEntries(entries, kind, reasons) {
  if (!Array.isArray(entries)) {
    reasons.push(`${kind} must be an array`);
    return;
  }
  const ids = new Set();
  for (const entry of entries) {
    if (typeof entry?.id !== 'string' || entry.id.length === 0) {
      reasons.push(`${kind} entry id must be a non-empty string`);
      continue;
    }
    if (ids.has(entry.id)) reasons.push(`${kind} id ${entry.id} is duplicated`);
    ids.add(entry.id);
    if (!STATUSES.has(entry.status)) reasons.push(`${kind} ${entry.id} has an invalid status`);
    if (!Array.isArray(entry.evidence)) {
      reasons.push(`${kind} ${entry.id} evidence must be an array`);
      continue;
    }
    if (entry.status === 'tested' && entry.evidence.length === 0) {
      reasons.push(`${kind} ${entry.id} cannot be tested without evidence`);
    }
    for (const path of entry.evidence) {
      if (
        typeof path !== 'string' ||
        !path.startsWith('reports/baseline/') ||
        path.includes('..') ||
        path.includes('\\')
      ) {
        reasons.push(`${kind} ${entry.id} has an unsafe evidence path`);
      }
    }
  }
}

export function compatibilityMatrixReasons(matrix, sdkVersion) {
  const reasons = [];
  if (matrix?.schemaVersion !== '1.0.0') reasons.push('schemaVersion must be 1.0.0');
  if (matrix?.sdkVersion !== sdkVersion) reasons.push(`sdkVersion must be ${sdkVersion}`);
  if (
    matrix?.policy?.runtimeProbeRequired !== true ||
    matrix?.policy?.userAgentDecisionAllowed !== false ||
    matrix?.policy?.blockedRunCountsAsPass !== false
  ) {
    reasons.push('compatibility decision policy differs');
  }
  validateEntries(matrix?.environments, 'environment', reasons);
  validateEntries(matrix?.axes, 'axis', reasons);
  const actualAxes = new Set(
    Array.isArray(matrix?.axes) ? matrix.axes.map(value => value?.id) : [],
  );
  for (const axis of REQUIRED_AXES) {
    if (!actualAxes.has(axis)) reasons.push(`required axis ${axis} is absent`);
  }
  return reasons;
}
