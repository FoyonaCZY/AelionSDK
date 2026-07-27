import {
  exportResumableMuxed,
  IndexedDbResumableMuxedExportStore,
  MemoryResumableMuxedExportStore,
  SeekableMemorySink,
  type ResumableMuxedProfile,
} from '@aelionsdk/export';

const durationUs = 2_000_000;
const sampleRate = 48_000;
const channelCount = 2;
const frameRate = { numerator: 30, denominator: 1 } as const;
const interruptionFractions = [0.25, 0.5, 0.9] as const;

interface CapturedArtifact {
  readonly id: string;
  readonly profile: ResumableMuxedProfile;
  readonly interruptionFraction: number | null;
  readonly bytes: readonly number[];
  readonly totalUnits: number;
  readonly reusedUnits: number;
  readonly encodedUnits: number;
  readonly renderedFrames: readonly number[];
  readonly firstRunCommittedUnits: number;
}

function renderFrame(request: {
  readonly frameIndex: number;
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly width: number;
  readonly height: number;
}): Promise<VideoFrame> {
  const canvas = new OffscreenCanvas(request.width, request.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D context unavailable');
  context.fillStyle = `rgb(${request.frameIndex * 7} ${request.frameIndex * 3} 127)`;
  context.fillRect(0, 0, request.width, request.height);
  context.fillStyle = 'white';
  context.fillRect(request.frameIndex % request.width, 4, 8, 8);
  return Promise.resolve(
    new VideoFrame(canvas, {
      timestamp: request.timestampUs,
      duration: request.durationUs,
    }),
  );
}

function renderAudio(request: {
  readonly startFrame: number;
  readonly frameCount: number;
  readonly sampleRate: number;
  readonly channelCount: number;
}): Promise<Float32Array> {
  return Promise.resolve(
    Float32Array.from({ length: request.frameCount * request.channelCount }, (_, index) => {
      const frame = request.startFrame + Math.floor(index / request.channelCount);
      return Math.sin((frame * 2 * Math.PI * 440) / request.sampleRate) * 0.05;
    }),
  );
}

const base = {
  contentId: 'phase-3-deterministic-av-v1',
  durationUs,
  segmentDurationUs: 200_000,
  width: 96,
  height: 54,
  frameRate,
  sampleRate,
  channelCount,
  videoBitrate: 300_000,
  audioBitrate: 128_000,
  renderFrame,
  renderAudio,
} as const;

async function reference(profile: ResumableMuxedProfile): Promise<CapturedArtifact> {
  const sink = new SeekableMemorySink();
  const result = await exportResumableMuxed({
    ...base,
    key: `phase-3-reference-${profile}`,
    profile,
    store: new MemoryResumableMuxedExportStore(),
    sink: sink.writable,
  });
  return {
    id: `${profile}-reference`,
    profile,
    interruptionFraction: null,
    bytes: [...sink.finalize()],
    totalUnits: result.totalUnits,
    reusedUnits: result.reusedUnits,
    encodedUnits: result.encodedUnits,
    renderedFrames: Array.from({ length: result.videoFrames }, (_, index) => index),
    firstRunCommittedUnits: result.totalUnits,
  };
}

async function interruptedRecovery(
  profile: ResumableMuxedProfile,
  totalUnits: number,
  interruptionFraction: (typeof interruptionFractions)[number],
): Promise<CapturedArtifact> {
  const committedTarget = Math.ceil(totalUnits * interruptionFraction);
  const databaseName = `aelion-phase-3-${crypto.randomUUID()}`;
  const key = `phase-3-${profile}-${interruptionFraction.toString()}`;
  const interruptedStore = new IndexedDbResumableMuxedExportStore({ databaseName });
  try {
    await exportResumableMuxed({
      ...base,
      key,
      profile,
      store: interruptedStore,
      sink: new SeekableMemorySink().writable,
      onUnitCommitted: completedUnits => {
        if (completedUnits === committedTarget) throw new Error('planned interruption');
      },
    });
    throw new Error('planned interruption did not stop the export');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'planned interruption') throw error;
  }

  // A new store instance proves that the committed prefix survives the
  // interruption instead of relying on in-memory object state.
  const resumedStore = new IndexedDbResumableMuxedExportStore({ databaseName });
  const renderedFrames: number[] = [];
  const sink = new SeekableMemorySink();
  const result = await exportResumableMuxed({
    ...base,
    key,
    profile,
    store: resumedStore,
    sink: sink.writable,
    renderFrame: request => {
      renderedFrames.push(request.frameIndex);
      return renderFrame(request);
    },
  });
  await resumedStore.delete(key);
  return {
    id: `${profile}-resume-${Math.round(interruptionFraction * 100).toString()}`,
    profile,
    interruptionFraction,
    bytes: [...sink.finalize()],
    totalUnits: result.totalUnits,
    reusedUnits: result.reusedUnits,
    encodedUnits: result.encodedUnits,
    renderedFrames,
    firstRunCommittedUnits: committedTarget,
  };
}

async function run(): Promise<{
  readonly evidenceVersion: '1.0.0';
  readonly fixture: 'Aelion deterministic segmented A/V';
  readonly durationUs: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly videoFrames: number;
  readonly audioFrames: number;
  readonly artifacts: readonly CapturedArtifact[];
}> {
  const artifacts: CapturedArtifact[] = [];
  for (const profile of ['webm-vp9-opus', 'mp4-h264-aac'] as const) {
    const uninterrupted = await reference(profile);
    artifacts.push(uninterrupted);
    for (const interruptionFraction of interruptionFractions) {
      artifacts.push(
        await interruptedRecovery(profile, uninterrupted.totalUnits, interruptionFraction),
      );
    }
  }
  return {
    evidenceVersion: '1.0.0',
    fixture: 'Aelion deterministic segmented A/V',
    durationUs,
    sampleRate,
    channelCount,
    videoFrames: 60,
    audioFrames: 96_000,
    artifacts,
  };
}

void run()
  .then(report => {
    Reflect.set(globalThis, '__AELION_RECOVERY_EVIDENCE__', report);
    const status = document.querySelector('#status');
    if (status !== null) status.textContent = 'AelionSDK recovery evidence complete';
  })
  .catch((error: unknown) => {
    Reflect.set(
      globalThis,
      '__AELION_RECOVERY_ERROR__',
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    );
  });
