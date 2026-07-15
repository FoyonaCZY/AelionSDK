import { createSampleIndex, decodeVideoFrameAt, videoDecoderResourceSnapshot } from '@aelion/media';

const fixtureNames = [
  'mp4-moov-head-h264-aac.mp4',
  'mp4-moov-tail-h264-aac.mp4',
  'mp4-fragmented-h264-aac.mp4',
  'mp4-nonzero-pts-h264-aac.mp4',
  'webm-vp9-opus-vfr.webm',
] as const;

async function fixture(name: string): Promise<Uint8Array> {
  const response = await fetch(`/fixtures/media/${name}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function run(): Promise<Record<string, unknown>> {
  const targetsUs = [550_000, 1_050_000, 1_550_000, 2_550_000];
  const fixtures = [];
  for (const name of fixtureNames) {
    const bytes = await fixture(name);
    const coldSamples = [];
    const coldStartedAt = performance.now();
    const index = await createSampleIndex(bytes);
    const indexMs = performance.now() - coldStartedAt;
    const video = index.tracks.find(track => track.kind === 'video');
    if (video === undefined) throw new Error(`${name} has no video track`);
    for (const targetUs of targetsUs) {
      const startedAt = performance.now();
      const result = await decodeVideoFrameAt(bytes, targetUs, { maxDecodeQueueSize: 8 });
      coldSamples.push({
        targetUs,
        presentationUs: result.timestampUs,
        elapsedMs: performance.now() - startedAt,
        decodedPackets: result.decodedPackets,
        plannedPackets: result.plannedPackets,
      });
      result.close();
    }

    const warmSamples = [];
    for (let iteration = 0; iteration < 3; iteration += 1) {
      for (const targetUs of targetsUs) {
        const startedAt = performance.now();
        const result = await decodeVideoFrameAt(bytes, targetUs, {
          maxDecodeQueueSize: 8,
          sampleIndex: index,
        });
        warmSamples.push({
          targetUs,
          presentationUs: result.timestampUs,
          elapsedMs: performance.now() - startedAt,
          decodedPackets: result.decodedPackets,
          plannedPackets: result.plannedPackets,
        });
        result.close();
      }
    }
    const coldLatencies = coldSamples.map(sample => sample.elapsedMs);
    const warmLatencies = warmSamples.map(sample => sample.elapsedMs);
    const decodedPackets = warmSamples.map(sample => sample.decodedPackets);
    fixtures.push({
      name,
      bytes: bytes.byteLength,
      container: index.container,
      codec: video.codec,
      firstPresentationUs:
        index.samples[video.id]?.find(sample => sample.presentationOrder === 0)
          ?.presentationTimestampUs ?? null,
      indexMs,
      cold: {
        count: coldSamples.length,
        p50Ms: percentile(coldLatencies, 0.5),
        p95Ms: percentile(coldLatencies, 0.95),
        maxMs: Math.max(...coldLatencies),
        samples: coldSamples,
      },
      warm: {
        count: warmSamples.length,
        p50Ms: percentile(warmLatencies, 0.5),
        p95Ms: percentile(warmLatencies, 0.95),
        maxMs: Math.max(...warmLatencies),
        maxDecodedPackets: Math.max(...decodedPackets),
        samples: warmSamples,
      },
      sampleIndex: {
        capabilities: index.capabilities,
        diagnostics: index.diagnostics.map(value => value.code),
      },
    });
  }
  return {
    evidenceVersion: '1.0.0',
    targetsUs,
    fixtures,
    resources: videoDecoderResourceSnapshot(),
    userAgent: navigator.userAgent,
  };
}

void run()
  .then(report => {
    Reflect.set(globalThis, '__AELION_SEEK_EVIDENCE__', report);
    const status = document.querySelector('#status');
    if (status !== null) status.textContent = 'AelionSDK seek evidence complete';
  })
  .catch((error: unknown) => {
    Reflect.set(
      globalThis,
      '__AELION_SEEK_ERROR__',
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    );
  });
