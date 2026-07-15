import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  PHASE_1_BLOCKER_REVIEW_CHECKS,
  PHASE_1_EVIDENCE_REFRESH_COMMANDS,
  PHASE_1_EXPECTED_BROWSER_TESTS,
  PHASE_1_POST_GATE_DOCUMENTS,
  PHASE_1_EXPECTED_PUBLIC_PACKAGES,
  PHASE_1_EXPECTED_RUNTIME_ASSETS,
  PHASE_1_REQUIRED_GATE_COMMANDS,
  PHASE_1_RUN_ARTIFACTS,
  WORKSPACE_IDENTITY_POLICY,
  buildBlockerReviewGateRunBinding,
  buildPhase1Postflight,
  excludedWorkspacePath,
  sha256,
  sourceIdentity,
  sourceIdentitiesEqual,
  stableJson,
  strictVitestSummary,
  validateAlphaCleanup,
  validateAlphaEvidence,
  validateBlockerReview,
  validateGateRunDocument,
  validatePerformanceEvidence,
  validatePhase1PostflightRecord,
  validateSeekEvidence,
  validateTarballConsumer,
} from './phase-1-evidence-lib.mjs';

const root = '/workspace';
const hash = 'a'.repeat(64);
const execFileAsync = promisify(execFile);

function identity() {
  return {
    kind: 'workspace-input-manifest',
    policyVersion: WORKSPACE_IDENTITY_POLICY.version,
    algorithm: WORKSPACE_IDENTITY_POLICY.algorithm,
    symbolicLinks: WORKSPACE_IDENTITY_POLICY.symbolicLinks,
    specialFiles: WORKSPACE_IDENTITY_POLICY.specialFiles,
    exclusions: [...WORKSPACE_IDENTITY_POLICY.exclusions],
    manifestSha256: hash,
    fileCount: 1,
    totalBytes: 1,
    vcs: { commit: null, tree: null },
  };
}

function browserIdentity() {
  const browserVersion = '149.0.7827.201';
  const userAgent = 'Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36';
  return {
    browserVersion,
    userAgent,
    referenceDevice: {
      architecture: 'x64',
      browser: `Google Chrome ${browserVersion}`,
      browserVersion,
      cpu: 'Test CPU, 8 logical CPUs',
      logicalCpuCount: 8,
      memoryBytes: 16 * 1_073_741_824,
      memoryGiB: 16,
      model: 'Linux x86_64',
      os: 'Linux 6.0',
      osBuild: null,
      osVersion: '6.0',
      physicalCoreCount: null,
      platform: 'linux',
      probe: {
        source: 'node:os',
        limitations: ['portable probe does not expose physical cores'],
      },
      userAgent,
    },
  };
}

function gateCommands() {
  return [...PHASE_1_REQUIRED_GATE_COMMANDS, ...PHASE_1_EVIDENCE_REFRESH_COMMANDS].map(
    (command, index) => ({
      command,
      startedAt: new Date(10_000 + index * 2_000).toISOString(),
      endedAt: new Date(11_000 + index * 2_000).toISOString(),
      exitCode: 0,
      summary: {},
    }),
  );
}

function passingPostflight(commands = gateCommands()) {
  const artifacts = PHASE_1_RUN_ARTIFACTS.map(expected => {
    const gate = commands.find(command => command.command === expected.command);
    return {
      ...expected,
      bytes: 1,
      sha256: hash,
      mtime: gate.endedAt,
      mtimeMs: Date.parse(gate.endedAt),
    };
  });
  const postflight = buildPhase1Postflight(
    commands,
    artifacts,
    '0.1.0-alpha.0',
    new Date(Date.parse(commands.at(-1).endedAt) + 1).toISOString(),
  );
  postflight.checks = postflight.checks.map(check => ({
    ...check,
    passed: true,
    reasons: undefined,
  }));
  postflight.failedChecks = [];
  postflight.passed = true;
  return postflight;
}

test('workspace identity excludes only the exact post-gate projections plus generated evidence', () => {
  assert.equal(excludedWorkspacePath(root, '/workspace/reports/a.json'), true);
  assert.equal(excludedWorkspacePath(root, '/workspace/a/__screenshots__/x.png'), true);
  for (const path of PHASE_1_POST_GATE_DOCUMENTS) {
    assert.equal(excludedWorkspacePath(root, `/workspace/${path}`), true);
  }
  assert.equal(excludedWorkspacePath(root, '/workspace/docs/GOAL.md'), false);
  assert.equal(excludedWorkspacePath(root, '/workspace/docs/evidence/other.md'), false);
  assert.equal(excludedWorkspacePath(root, '/workspace/packages/sdk/src/index.ts'), false);
});

test('post-gate projections do not churn source identity but every other document remains bound', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'aelion-phase-1-identity-'));
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true });
    await writeFile(join(workspace, 'README.md'), 'candidate\n');
    await writeFile(join(workspace, 'docs', 'GOAL-PHASE-1.md'), 'active\n');
    await writeFile(join(workspace, 'docs', 'design.md'), 'design-v1\n');
    const before = await sourceIdentity(workspace);
    await writeFile(join(workspace, 'README.md'), 'complete\n');
    await writeFile(join(workspace, 'docs', 'GOAL-PHASE-1.md'), 'complete\n');
    const postGateUpdate = await sourceIdentity(workspace);
    assert.equal(postGateUpdate.manifestSha256, before.manifestSha256);
    await writeFile(join(workspace, 'docs', 'design.md'), 'design-v2\n');
    const designUpdate = await sourceIdentity(workspace);
    assert.notEqual(designUpdate.manifestSha256, before.manifestSha256);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('source identity rejects every non-excluded symbolic link', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'aelion-phase-1-symlink-'));
  try {
    await writeFile(join(workspace, 'target.ts'), 'export {};\n');
    await symlink('target.ts', join(workspace, 'linked.ts'));
    await assert.rejects(sourceIdentity(workspace), /refuses non-excluded symbolic link/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('source identity equality binds every policy field', () => {
  const baseline = identity();
  assert.equal(sourceIdentitiesEqual(baseline, identity()), true);
  for (const candidate of [
    { ...identity(), algorithm: 'sha512(stable-json(files))' },
    { ...identity(), symbolicLinks: 'follow symbolic links' },
    { ...identity(), specialFiles: 'ignore special files' },
    { ...identity(), exclusions: [...WORKSPACE_IDENTITY_POLICY.exclusions, 'extra exclusion'] },
    { ...identity(), exclusions: [...WORKSPACE_IDENTITY_POLICY.exclusions].reverse() },
  ]) {
    assert.equal(sourceIdentitiesEqual(baseline, candidate), false);
  }
});

test(
  'source identity rejects non-regular filesystem entries',
  { skip: process.platform === 'win32' },
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aelion-phase-1-special-file-'));
    try {
      await writeFile(join(workspace, 'package.json'), '{}\n');
      await execFileAsync('mkfifo', [join(workspace, 'unbound.ts')]);
      await assert.rejects(sourceIdentity(workspace), /refuses non-excluded special file/u);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

test('the final runner policy is exactly nine gates plus five evidence refreshes', () => {
  assert.equal(PHASE_1_REQUIRED_GATE_COMMANDS.length, 9);
  assert.deepEqual(PHASE_1_EXPECTED_BROWSER_TESTS, { chromium: 59, firefox: 54 });
  assert.deepEqual(PHASE_1_EVIDENCE_REFRESH_COMMANDS, [
    'corepack pnpm report:browser:chromium',
    'corepack pnpm report:browser:firefox',
    'corepack pnpm report:seek',
    'corepack pnpm report:performance',
    'corepack pnpm report:alpha',
  ]);
});

test('seek and performance validators fail closed on resource or SLO drift', () => {
  const targetsUs = [550_000, 1_050_000, 1_550_000, 2_550_000];
  const sample = targetUs => ({
    targetUs,
    presentationUs: targetUs,
    elapsedMs: 1,
    decodedPackets: 1,
    plannedPackets: 1,
  });
  const fixture = (name, container, presentationsUs) => {
    const samples = targetsUs.map((targetUs, index) => ({
      ...sample(targetUs),
      presentationUs: presentationsUs[index],
    }));
    return {
      name,
      bytes: 1,
      container,
      codec: 'codec',
      indexMs: 1,
      cold: { count: 4, p50Ms: 1, p95Ms: 1, maxMs: 1, samples },
      warm: {
        count: 12,
        p50Ms: 1,
        p95Ms: 1,
        maxMs: 1,
        samples: Array.from({ length: 3 }, () => samples.map(value => ({ ...value }))).flat(),
      },
      sampleIndex: { capabilities: { timingAndSize: true }, diagnostics: [] },
    };
  };
  const mp4PresentationsUs = [533_333, 1_033_333, 1_533_333, 2_533_333];
  const webmPresentationsUs = [533_000, 1_000_000, 1_533_000, 2_533_000];
  const seek = {
    evidenceVersion: '1.0.0',
    command: 'corepack pnpm report:seek',
    browser: browserIdentity().referenceDevice.browser,
    browserVersion: browserIdentity().browserVersion,
    userAgent: browserIdentity().userAgent,
    targetsUs,
    fixtures: [
      fixture('mp4-moov-head-h264-aac.mp4', 'mp4', mp4PresentationsUs),
      fixture('mp4-moov-tail-h264-aac.mp4', 'mp4', mp4PresentationsUs),
      fixture('mp4-fragmented-h264-aac.mp4', 'mp4', mp4PresentationsUs),
      fixture('mp4-nonzero-pts-h264-aac.mp4', 'mp4', mp4PresentationsUs),
      fixture('webm-vp9-opus-vfr.webm', 'webm', webmPresentationsUs),
    ],
    resources: { activeDecoders: 0, retainedFrames: 0 },
  };
  assert.equal(validateSeekEvidence(seek).passed, true);
  assert.equal(
    validateSeekEvidence({ ...seek, resources: { activeDecoders: 1, retainedFrames: 0 } }).passed,
    false,
  );
  const wrongTargetMultiplicity = JSON.parse(JSON.stringify(seek));
  wrongTargetMultiplicity.fixtures[0].warm.samples[1].targetUs = targetsUs[0];
  assert.equal(validateSeekEvidence(wrongTargetMultiplicity).passed, false);
  const wrongPresentation = JSON.parse(JSON.stringify(seek));
  wrongPresentation.fixtures[0].cold.samples[0].presentationUs = 0;
  assert.equal(validateSeekEvidence(wrongPresentation).passed, false);
  const wrongSeekP95 = JSON.parse(JSON.stringify(seek));
  wrongSeekP95.fixtures[0].cold.p95Ms = 2;
  assert.equal(validateSeekEvidence(wrongSeekP95).passed, false);

  const benchmark = (frames, passes, p95Ms = 1) => ({
    resolution: { width: 1_920, height: 1_080 },
    frames,
    passCount: passes,
    wall: { p50Ms: 1, p95Ms },
    worker: { p50Us: 1, p95Us: 1 },
    gpuCompletion: { p50Us: 1, p95Us: 1 },
    throughputFps: 1_000,
    resourcesBeforeDispose: { disposed: false, pendingRequests: 0 },
    resourcesAfterDispose: { disposed: true, pendingRequests: 0 },
  });
  const performance = {
    evidenceVersion: '1.0.0',
    command: 'corepack pnpm report:performance',
    fixture: 'Aelion 1080p30 SDR reference',
    ...browserIdentity(),
    material: {
      warmFilmWebGl2: benchmark(30, 1),
      warmFilmWebGpu: benchmark(30, 1),
      softGlow: benchmark(12, 4),
    },
    export: {
      resolution: { width: 1_920, height: 1_080 },
      durationUs: 5_000_000,
      videoFrames: 150,
      audioFrames: 240_000,
      elapsedMs: 2_000,
      realtimeMultiple: 2.5,
      bytes: 100,
      sink: {
        writes: 2,
        bytesWritten: 110,
        finalSize: 100,
        maxInFlightWrites: 1,
        closed: true,
        aborted: false,
      },
      mainThread: {
        contract: 'codec-initialization-disclosed; steady-state begins at the second video frame',
        initialization: {
          supported: true,
          startedAtMs: 10,
          completedAtMs: 1_010,
          elapsedMs: 1_000,
          tasks: [],
          longTasksOver50Ms: 0,
          maxLongTaskMs: 0,
        },
        steady: {
          supported: true,
          startedAtMs: 1_010,
          completedAtMs: 2_010,
          elapsedMs: 1_000,
          tasks: [],
          longTasksOver50Ms: 0,
          maxLongTaskMs: 0,
        },
        overall: {
          supported: true,
          startedAtMs: 10,
          completedAtMs: 2_010,
          elapsedMs: 2_000,
          tasks: [],
          longTasksOver50Ms: 0,
          maxLongTaskMs: 0,
        },
      },
      phases: [
        { name: 'export-call', atMs: 10 },
        { name: 'first-video-render-start', atMs: 10.1 },
        { name: 'first-video-render-end', atMs: 10.2 },
        { name: 'second-video-render-start', atMs: 1_010 },
        { name: 'video-complete', atMs: 1_500 },
        { name: 'first-audio-render-start', atMs: 1_600 },
        { name: 'first-audio-render-end', atMs: 1_700 },
        { name: 'export-complete', atMs: 2_009 },
      ],
    },
    longTimeline: {
      simulatedDurationUs: 600_000_000,
      elapsedMs: 1,
      boundedBytes: 32_800,
      pcm: {
        capacityFrames: 4_096,
        availableReadFrames: 0,
        availableWriteFrames: 4_096,
        playedFrames: 28_800_000,
        underrunFrames: 0,
        state: 'open',
      },
      heapSamples: Array.from({ length: 10 }, (_, index) => ({
        equivalentMinute: index + 1,
        usedJsHeapBytes: 1,
      })),
      memory: {
        before: { usedJsHeapBytes: 1, totalJsHeapBytes: 2 },
        after: { usedJsHeapBytes: 1, totalJsHeapBytes: 2 },
      },
    },
  };
  assert.equal(validatePerformanceEvidence(performance).passed, true);
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      referenceDevice: { ...performance.referenceDevice, serialNumber: 'must-not-pass' },
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      longTimeline: {
        ...performance.longTimeline,
        heapSamples: performance.longTimeline.heapSamples.map((sample, index) => ({
          ...sample,
          usedJsHeapBytes: (index + 1) * 1_000_000_000_000,
        })),
      },
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      export: { ...performance.export, realtimeMultiple: 999 },
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      export: { ...performance.export, elapsedMs: 1 },
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      export: {
        ...performance.export,
        sink: { ...performance.export.sink, finalSize: 99 },
      },
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      material: {
        ...performance.material,
        warmFilmWebGl2: { ...performance.material.warmFilmWebGl2, throughputFps: 1 },
      },
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      userAgent: 'Mozilla/5.0 Chrome/148.0.0.0',
    }).passed,
    false,
  );
  assert.equal(
    validatePerformanceEvidence({
      ...performance,
      export: {
        ...performance.export,
        mainThread: {
          ...performance.export.mainThread,
          steady: { ...performance.export.mainThread.steady, longTasksOver50Ms: 1 },
        },
      },
    }).passed,
    false,
  );
  for (const invalidExport of [
    {
      ...performance.export,
      mainThread: {
        ...performance.export.mainThread,
        steady: {
          ...performance.export.mainThread.steady,
          startedAtMs: 1_500,
          elapsedMs: 510,
        },
      },
    },
    {
      ...performance.export,
      phases: [...performance.export.phases, { name: 'export-complete', atMs: 12 }],
    },
    {
      ...performance.export,
      phases: performance.export.phases.map((phase, index) =>
        index === 2 ? { ...phase, atMs: 9 } : phase,
      ),
    },
  ]) {
    assert.equal(
      validatePerformanceEvidence({ ...performance, export: invalidExport }).passed,
      false,
    );
  }
});

test('strict browser summaries require exact reviewed counts and zero skipped work', () => {
  const expected = PHASE_1_EXPECTED_BROWSER_TESTS.chromium;
  const assertions = Array.from({ length: expected }, () => ({ status: 'passed' }));
  const valid = {
    success: true,
    startTime: Date.now(),
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: expected,
    numPassedTests: expected,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ status: 'passed', assertionResults: assertions }],
  };
  assert.equal(strictVitestSummary(valid, expected).passed, true);
  assert.equal(strictVitestSummary({ ...valid, numTodoTests: 1 }, expected).passed, false);
});

test('gate record must be serial and bound to one source identity', () => {
  const commands = gateCommands();
  const document = {
    schemaVersion: '3.0.0',
    generatedBy: 'scripts/run-phase-1-final-gates.mjs',
    startedAt: commands[0].startedAt,
    endedAt: new Date(Date.parse(commands.at(-1).endedAt) + 2).toISOString(),
    sourceIdentityBefore: identity(),
    sourceIdentityAfter: identity(),
    sourceIdentityMatches: true,
    postflight: passingPostflight(commands),
    commands,
  };
  assert.equal(validateGateRunDocument(document, hash).passed, true);
  commands[1].startedAt = commands[0].startedAt;
  assert.equal(validateGateRunDocument(document, hash).passed, false);
  commands[1].startedAt = new Date(Date.parse(commands[0].endedAt) + 1).toISOString();
  commands[1].exitCode = 1;
  assert.equal(validateGateRunDocument(document, hash).passed, false);
});

test('tarball consumer validator checks exact package, asset and browser contracts', () => {
  const version = '0.1.0-alpha.0';
  const packages = PHASE_1_EXPECTED_PUBLIC_PACKAGES.map((name, index) => ({
    name,
    version,
    sha256: index.toString(16).padStart(64, '0'),
  }));
  const runtimeAssets = PHASE_1_EXPECTED_RUNTIME_ASSETS.map((id, index) => ({
    id,
    file: `dist/assets/${id}.js`,
    publicUrl: `/assets/${id}.js`,
    bytes: 1,
    sha256: (index + 20).toString(16).padStart(64, '0'),
  }));
  const dependencyContract = Object.fromEntries(
    PHASE_1_EXPECTED_PUBLIC_PACKAGES.map(name => [
      name,
      `${name.slice(1).replace('/', '-')}-${version}.tgz`,
    ]),
  );
  const browser = name => ({
    browser: name,
    report: {
      userAgent: name,
      crossOriginIsolated: true,
      workerCompositor: {
        backend: 'webgl2',
        graphHash: 'hash',
        pixel: [245, 235, 225, 255],
        workerTimingUs: 1,
      },
      audioWorkletClock: {
        contextState: 'suspended',
        sampleRate: 48_000,
        quantumFrames: 128,
        queuedFrames: 24_000,
        capacityFrames: 96_000,
        availableReadFrames: 23_488,
        playedFrames: 512,
        underrunFrames: 0,
        timeUs: 1,
      },
      sessionFacade: {
        revision: '3',
        state: 'ready',
        backend: 'webgl2',
        width: 16,
        height: 16,
      },
    },
  });
  const plugin = packages.find(value => value.name === '@aelion/vite-plugin');
  const report = {
    schemaVersion: '1.0.0',
    command: 'corepack pnpm test:consumer',
    sdkVersion: version,
    packages,
    runtimeAssets,
    bundlerAdapter: {
      id: '@aelion/vite-plugin',
      package: '@aelion/vite-plugin',
      version,
      public: true,
      zeroConfigVite: false,
      packageSha256: plugin.sha256,
      contractSha256: hash,
      viteConfigSha256: hash,
      configuration: 'plugins: [aelion()]',
    },
    consumerContract: {
      typecheck: 'node node_modules/typescript/bin/tsc --noEmit',
      packageJsonSha256: hash,
      sourceSha256: hash,
      tsconfigSha256: hash,
      dependencyContract,
      dependencyContractSha256: sha256(stableJson(dependencyContract)),
    },
    browsers: [browser('chromium'), browser('firefox')],
  };
  assert.equal(validateTarballConsumer(report, version).passed, true);
  assert.equal(
    validateTarballConsumer({ ...report, packages: packages.slice(1) }, version).passed,
    false,
  );
  for (const invalidAudio of [
    { ...browser('chromium').report.audioWorkletClock, playedFrames: 0 },
    { ...browser('chromium').report.audioWorkletClock, playedFrames: 513 },
    {
      ...browser('chromium').report.audioWorkletClock,
      playedFrames: 24_128,
      availableReadFrames: -128,
    },
    { ...browser('chromium').report.audioWorkletClock, availableReadFrames: 23_000 },
  ]) {
    const invalidReport = {
      ...report,
      browsers: [
        {
          ...browser('chromium'),
          report: { ...browser('chromium').report, audioWorkletClock: invalidAudio },
        },
        browser('firefox'),
      ],
    };
    assert.equal(validateTarballConsumer(invalidReport, version).passed, false);
  }
});

test('Alpha cleanup and blocker review both fail closed', () => {
  const zero = Object.fromEntries(
    [
      'assets',
      'cachedBytes',
      'inFlightAssetLoads',
      'inFlightSampleIndexes',
      'inFlightRequests',
      'sharedOperationSubscribers',
      'activeOperations',
      'pendingOperations',
      'activeLoads',
      'pendingLoads',
    ].map(name => [name, 0]),
  );
  const alpha = {
    evidenceVersion: '1.0.0',
    command: 'corepack pnpm report:alpha',
    generatedAt: new Date().toISOString(),
    ...browserIdentity(),
    projectId: 'prj_alpha_60s',
    fixture: 'examples/aelion-alpha-60s.project.json',
    durationUs: 60_000_000,
    revisions: { initial: '0', edited: '1', undo: '2', redo: '3' },
    history: { canUndo: true, canRedo: false },
    player: {
      state: 'paused',
      currentTimeUs: 30_758_667,
      emittedFrames: 5,
      firstTimestampUs: 29_500_000,
      lastTimestampUs: 30_733_333,
    },
    preview: {
      width: 320,
      height: 180,
      backend: 'webgl2',
      materialIds: ['mat_warm', 'mat_dissolve'],
    },
    export: {
      mimeType: 'video/webm; codecs="vp09.00.10.08, opus"',
      durationUs: 60_000_000,
      videoFrames: 1_800,
      audioFrames: 2_880_000,
    },
    readback: {
      container: 'webm',
      durationUs: 60_000_000,
      videoCodec: 'vp9',
      audioCodec: 'opus',
      videoSamples: 1_800,
      audioSamples: 3_001,
      videoEndUs: 60_000_333,
      audioEndUs: 60_000_000,
      avEndDriftUs: 333,
    },
    mainThread: { longTasksOver50Ms: 0, maxLongTaskMs: 0 },
    progress: [0.1, 0.5, 1],
    publicApi: {
      usedFacadeOnly: true,
      sessionEvents: [
        'state-changed',
        'project-loaded',
        'project-changed',
        'project-changed',
        'project-changed',
        'stats-changed',
      ],
    },
    elapsedMs: 1,
    memory: {
      before: { usedJsHeapBytes: 10, totalJsHeapBytes: 20 },
      beforeDispose: { usedJsHeapBytes: 20, totalJsHeapBytes: 30 },
    },
    artifact: {
      file: 'reports/baseline/alpha-60s.webm',
      bytes: 1,
      sha256: hash,
    },
    externalReadback: {
      implementation: 'ffmpeg version 8.1-test',
      videoDecode: 'passed',
      audioDecode: 'passed',
      videoFrameMd5DocumentSha256: 'b'.repeat(64),
      audioPcmMd5: `MD5=${'c'.repeat(32)}`,
    },
    resources: {
      sessionStateBeforeDispose: 'ready',
      sessionStateAfterDispose: 'disposed',
      opfsOutputRemoved: true,
      providerDrained: true,
      mediaBeforeDispose: { ...zero },
      mediaAfterDispose: { ...zero },
      sessionRuntimeBeforeDispose: {
        renderer: {
          requestedFrames: 6,
          renderedFrames: 6,
          failedFrames: 0,
          lastBackend: 'webgl2',
          rendererPresent: true,
          rendererDisposed: false,
          pendingFrames: 0,
          maxPendingFrames: 2,
          workerPendingRequests: 0,
          workerActiveRequests: 0,
          workerCancelledRequests: 0,
        },
        player: {
          listeners: 1,
          runtimeInitializing: false,
          audioFillInFlight: false,
          scheduler: { present: true, disposed: false },
          audio: {
            mode: 'transferable-queue',
            disposed: false,
            bufferedFrames: 1,
            closed: false,
          },
        },
        activeExportJobId: null,
      },
      sessionRuntimeAfterDispose: {
        renderer: {
          rendererPresent: false,
          rendererDisposed: true,
          pendingFrames: 0,
          workerPendingRequests: 0,
          workerActiveRequests: 0,
          workerCancelledRequests: 0,
          lastDisposedRenderer: {
            disposed: true,
            pendingFrames: 0,
            workerDisposed: true,
            workerPendingRequests: 0,
            workerActiveRequests: 0,
            workerCancelledRequests: 0,
          },
        },
        player: {
          listeners: 0,
          runtimeInitializing: false,
          audioFillScheduled: false,
          audioFillInFlight: false,
          scheduler: { present: false, disposed: true, scheduled: false, rendering: false },
          audio: {
            mode: 'none',
            disposed: true,
            contextState: null,
            bufferedFrames: 0,
            closed: true,
          },
          lastDisposedRuntime: {
            schedulerDisposed: true,
            audioDisposed: true,
            audioContextClosed: true,
            transportClosed: true,
            bufferedFrames: 0,
          },
        },
        activeExportJobId: null,
      },
    },
    sink: {
      fileName: 'alpha.webm',
      writes: 2,
      bytesWritten: 2,
      closed: true,
      aborted: false,
    },
    queues: { sinkMaxInFlightWrites: 1 },
  };
  Object.assign(alpha.resources.mediaBeforeDispose, {
    assets: 3,
    cachedBytes: 1,
    maxCachedBytes: 16 * 1_024 * 1_024,
    maxInFlightRequests: 68,
    maxConcurrentOperations: 4,
    maxPendingOperations: 64,
    maxConcurrentLoads: 4,
  });
  const validCleanup = validateAlphaCleanup(alpha);
  assert.equal(validCleanup.passed, true, JSON.stringify(validCleanup.reasons));
  const validAlpha = validateAlphaEvidence(alpha);
  assert.equal(validAlpha.passed, true, JSON.stringify(validAlpha.reasons));
  for (const field of ['revisions', 'history', 'player', 'preview', 'progress', 'publicApi']) {
    assert.equal(validateAlphaEvidence({ ...alpha, [field]: null }).passed, false);
  }
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      mainThread: { longTasksOver50Ms: 0, maxLongTaskMs: 999_999 },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      memory: {
        ...alpha.memory,
        beforeDispose: {
          usedJsHeapBytes: 1_000_000_000_000_000,
          totalJsHeapBytes: 1_000_000_000_000_000,
        },
      },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      resources: {
        ...alpha.resources,
        mediaBeforeDispose: {
          ...alpha.resources.mediaBeforeDispose,
          maxPendingOperations: Number.MAX_SAFE_INTEGER,
        },
      },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      resources: {
        ...alpha.resources,
        sessionRuntimeBeforeDispose: {
          ...alpha.resources.sessionRuntimeBeforeDispose,
          renderer: {
            ...alpha.resources.sessionRuntimeBeforeDispose.renderer,
            maxPendingFrames: Number.MAX_SAFE_INTEGER,
          },
        },
      },
    }).passed,
    false,
  );
  assert.equal(validateAlphaEvidence({ ...alpha, progress: [0.1, 0.1, 1] }).passed, false);
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      sink: { ...alpha.sink, bytesWritten: 0 },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      publicApi: { ...alpha.publicApi, usedFacadeOnly: false },
    }).passed,
    false,
  );
  for (const externalReadback of [
    { ...alpha.externalReadback, implementation: '' },
    { ...alpha.externalReadback, videoFrameMd5DocumentSha256: sha256('') },
    { ...alpha.externalReadback, audioPcmMd5: '' },
    { ...alpha.externalReadback, audioPcmMd5: 'MD5=d41d8cd98f00b204e9800998ecf8427e' },
  ]) {
    assert.equal(validateAlphaEvidence({ ...alpha, externalReadback }).passed, false);
  }
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      readback: { ...alpha.readback, videoEndUs: 1 },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      readback: { ...alpha.readback, container: 'mp4' },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaEvidence({
      ...alpha,
      export: { ...alpha.export, durationUs: 1 },
    }).passed,
    false,
  );
  assert.equal(
    validateAlphaCleanup({ ...alpha, resources: { ...alpha.resources, opfsOutputRemoved: false } })
      .passed,
    false,
  );
  assert.equal(
    validateAlphaCleanup({
      ...alpha,
      resources: {
        ...alpha.resources,
        sessionRuntimeAfterDispose: {
          ...alpha.resources.sessionRuntimeAfterDispose,
          player: {
            ...alpha.resources.sessionRuntimeAfterDispose.player,
            audioFillInFlight: true,
          },
        },
      },
    }).passed,
    false,
  );

  const gateEndedAt = new Date(Date.now() - 2_000).toISOString();
  const files = [
    {
      file: 'reports/baseline/alpha-60s.json',
      command: 'corepack pnpm report:alpha',
      bytes: 1,
      sha256: 'b'.repeat(64),
      mtime: new Date(Date.now() - 3_000).toISOString(),
    },
  ];
  const gateRun = {
    resultsSha256: 'c'.repeat(64),
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    endedAt: gateEndedAt,
    sourceManifestSha256: hash,
    artifacts: { files, setSha256: sha256(stableJson(files)) },
  };
  const review = {
    schemaVersion: '3.0.0',
    evidenceKind: 'aelion-phase-1-blocker-review',
    generatedAt: new Date().toISOString(),
    decision: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewers: ['independent-reviewer'],
    sourceIdentity: {
      policyVersion: WORKSPACE_IDENTITY_POLICY.version,
      manifestSha256: hash,
    },
    gateRun,
    checks: Object.fromEntries(PHASE_1_BLOCKER_REVIEW_CHECKS.map(name => [name, true])),
    blockers: [],
  };
  assert.equal(validateBlockerReview(review, identity(), { gateRun }).passed, true);
  assert.equal(
    validateBlockerReview({ ...review, decision: 'not-approved' }, identity(), { gateRun }).passed,
    false,
  );
  assert.equal(
    validateBlockerReview(
      { ...review, reviewedAt: new Date(Date.parse(gateEndedAt) - 1).toISOString() },
      identity(),
      { gateRun },
    ).passed,
    false,
  );
  assert.equal(
    validateBlockerReview(review, identity(), {
      gateRun: { ...gateRun, resultsSha256: 'd'.repeat(64) },
    }).passed,
    false,
  );
});

test('blocker review gate binding requires fresh exact artifacts from the serial run', () => {
  const startedAt = new Date(10_000).toISOString();
  const endedAt = new Date(50_000).toISOString();
  const commands = gateCommands();
  const runDocument = {
    schemaVersion: '3.0.0',
    generatedBy: 'scripts/run-phase-1-final-gates.mjs',
    startedAt,
    endedAt,
    sourceIdentityBefore: identity(),
    sourceIdentityAfter: identity(),
    sourceIdentityMatches: true,
    postflight: passingPostflight(commands),
    commands,
  };
  const policy = [
    {
      file: 'reports/baseline/browser-smoke-chromium.json',
      command: 'corepack pnpm report:browser:chromium',
    },
    {
      file: 'reports/baseline/browser-smoke-firefox.json',
      command: 'corepack pnpm report:browser:firefox',
    },
    { file: 'reports/baseline/media-seek-chromium.json', command: 'corepack pnpm report:seek' },
    {
      file: 'reports/baseline/performance-1080p30-chromium.json',
      command: 'corepack pnpm report:performance',
    },
    { file: 'reports/baseline/tarball-consumer.json', command: 'corepack pnpm test:consumer' },
    { file: 'reports/baseline/alpha-60s.json', command: 'corepack pnpm report:alpha' },
    { file: 'reports/baseline/alpha-60s.webm', command: 'corepack pnpm report:alpha' },
    ...PHASE_1_POST_GATE_DOCUMENTS.map(file => ({ file, freshness: 'post-run' })),
  ];
  const artifacts = policy.map((expected, index) => {
    const gate = commands.find(value => value.command === expected.command);
    const mtime = expected.freshness === 'post-run' ? endedAt : gate.endedAt;
    return {
      ...expected,
      bytes: index + 1,
      sha256: (index + 10).toString(16).padStart(64, '0'),
      mtime,
      mtimeMs: Date.parse(mtime),
    };
  });
  runDocument.postflight.artifacts.files = artifacts
    .slice(0, PHASE_1_RUN_ARTIFACTS.length)
    .map(({ file, command, bytes, sha256: digest, mtime }) => ({
      file,
      command,
      bytes,
      sha256: digest,
      mtime,
    }));
  runDocument.postflight.artifacts.setSha256 = sha256(
    stableJson(runDocument.postflight.artifacts.files),
  );
  assert.equal(buildBlockerReviewGateRunBinding(runDocument, hash, artifacts).passed, true);
  artifacts[0] = { ...artifacts[0], mtime: new Date(0).toISOString(), mtimeMs: 0 };
  assert.equal(buildBlockerReviewGateRunBinding(runDocument, hash, artifacts).passed, false);
  const postGateIndex = policy.findIndex(value => value.freshness === 'post-run');
  artifacts[0] = {
    ...policy[0],
    bytes: 1,
    sha256: (10).toString(16).padStart(64, '0'),
    mtime: commands.find(value => value.command === policy[0].command).endedAt,
    mtimeMs: Date.parse(commands.find(value => value.command === policy[0].command).endedAt),
  };
  artifacts[postGateIndex] = {
    ...artifacts[postGateIndex],
    mtime: new Date(Date.parse(endedAt) - 1).toISOString(),
    mtimeMs: Date.parse(endedAt) - 1,
  };
  assert.equal(buildBlockerReviewGateRunBinding(runDocument, hash, artifacts).passed, false);
  artifacts.splice(postGateIndex, 1);
  assert.equal(buildBlockerReviewGateRunBinding(runDocument, hash, artifacts).passed, false);
});

test('postflight fails closed on command, freshness, semantic and binding drift', () => {
  const commands = gateCommands();
  const artifacts = PHASE_1_RUN_ARTIFACTS.map(expected => {
    const gate = commands.find(command => command.command === expected.command);
    return {
      ...expected,
      bytes: 1,
      sha256: hash,
      mtime: gate.endedAt,
      mtimeMs: Date.parse(gate.endedAt),
    };
  });
  const failed = buildPhase1Postflight(
    commands,
    artifacts,
    '0.1.0-alpha.0',
    new Date(Date.parse(commands.at(-1).endedAt) + 1).toISOString(),
  );
  assert.equal(failed.passed, false);
  assert.ok(failed.failedChecks.some(id => id.endsWith('-semantic')));
  assert.equal(validatePhase1PostflightRecord(failed).passed, false);

  const passing = passingPostflight(commands);
  assert.equal(validatePhase1PostflightRecord(passing).passed, true);
  assert.equal(
    validatePhase1PostflightRecord({ ...passing, schemaVersion: '2.0.0' }).passed,
    false,
  );
  assert.equal(
    validatePhase1PostflightRecord({
      ...passing,
      artifacts: { ...passing.artifacts, setSha256: 'b'.repeat(64) },
    }).passed,
    false,
  );
  assert.equal(
    buildPhase1Postflight(
      commands.map((command, index) => (index === 0 ? { ...command, exitCode: 1 } : command)),
      artifacts,
      '0.1.0-alpha.0',
    ).passed,
    false,
  );
  assert.equal(
    buildPhase1Postflight(
      commands,
      artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, mtimeMs: 0, mtime: new Date(0).toISOString() } : artifact,
      ),
      '0.1.0-alpha.0',
    ).passed,
    false,
  );
});
