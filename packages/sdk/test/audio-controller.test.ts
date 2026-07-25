import type { PcmSourceBlock } from '@aelion/audio';
import { describe, expect, it } from 'vitest';

import {
  AelionSession,
  createMasteredAudioRenderer,
  createProject,
  seconds,
  type AelionMediaProvider,
} from '../src/index.js';

function audioProvider(): AelionMediaProvider {
  return {
    frameAt: () => Promise.reject(new Error('No video in audio test')),
    pcmRange: (_assetId, _streamIndex, startUs, durationUs): Promise<PcmSourceBlock> => {
      const sampleRate = 48_000;
      const startFrame = Math.floor((startUs * sampleRate) / 1_000_000);
      const frameCount = Math.ceil((durationUs * sampleRate) / 1_000_000);
      return Promise.resolve({
        sampleRate,
        channelCount: 1,
        frameCount,
        interleaved: Float32Array.from({ length: frameCount }, (_, offset) => {
          const frame = startFrame + offset;
          return frame >= 12_000 && frame < 36_000 ? Math.sin(frame / 10) * 0.5 : 0;
        }),
      });
    },
  };
}

function audioProject() {
  const builder = createProject({
    projectId: 'audio_project',
    sequenceId: 'audio_sequence',
    durationUs: seconds(1),
    channelLayout: 'mono',
  });
  builder.addAsset({ id: 'audio_asset', kind: 'audio' });
  const trackId = builder.addTrack({ id: 'dialogue', kind: 'audio' });
  builder.addMediaClip({
    id: 'dialogue_clip',
    kind: 'audio',
    assetId: 'audio_asset',
    trackId,
    durationUs: seconds(1),
  });
  return builder.build();
}

function constantAudioProvider(values: Readonly<Record<string, number>>): AelionMediaProvider {
  return {
    frameAt: () => Promise.reject(new Error('No video in audio test')),
    pcmRange: (assetId, _streamIndex, _startUs, durationUs): Promise<PcmSourceBlock> => {
      const sampleRate = 48_000;
      const frameCount = Math.ceil((durationUs * sampleRate) / 1_000_000);
      return Promise.resolve({
        sampleRate,
        channelCount: 1,
        frameCount,
        interleaved: new Float32Array(frameCount).fill(values[assetId] ?? 0),
      });
    },
  };
}

describe('Session audio product API', () => {
  it('analyzes loudness, builds waveform peaks and persists mastering by revision', async () => {
    const session = new AelionSession({ media: audioProvider() });
    await session.loadProject(audioProject());
    try {
      const report = await session.audio.analyze({ itemIds: ['dialogue_clip'] });
      expect(report.integratedLufs).toBeGreaterThan(Number.NEGATIVE_INFINITY);
      const waveform = await session.audio.waveform({
        itemIds: ['dialogue_clip'],
        maxPoints: 50,
      });
      expect(waveform.peaks.length).toBeLessThanOrEqual(50);
      expect(waveform.peaks.some(peak => (peak.max[0] ?? 0) > 0)).toBe(true);

      const commit = session.audio.configureMastering({
        targetLufs: -16,
        limiter: { ceilingDbtp: -1 },
      });
      expect(commit.revision).toBe(1n);
      expect(session.audio.getMastering()).toEqual({
        targetLufs: -16,
        limiter: { ceilingDbtp: -1 },
      });
      expect(session.getSnapshot().project?.sequences.audio_sequence?.extensions).toHaveProperty(
        'aelion.audio.mastering',
      );
    } finally {
      await session.dispose();
    }
  });

  it('detects and removes silence through one validated undoable transaction', async () => {
    const session = new AelionSession({ media: audioProvider() });
    await session.loadProject(audioProject());
    try {
      const detection = await session.audio.detectSilence({
        itemId: 'dialogue_clip',
        thresholdDb: -30,
        minimumSilenceUs: 0,
        paddingUs: 0,
        windowFrames: 1_024,
      });
      expect(detection.removedFrames).toBeGreaterThan(20_000);
      expect(detection.nonSilent).toHaveLength(1);

      const result = await session.audio.removeSilence({
        itemId: 'dialogue_clip',
        thresholdDb: -30,
        minimumSilenceUs: 0,
        paddingUs: 0,
        windowFrames: 1_024,
      });
      expect(result.commit.revision).toBe(1n);
      expect(result.removedUs).toBeGreaterThan(400_000);
      expect(result.itemIds).toEqual(['dialogue_clip']);
      const compacted = session.getSnapshot().project?.items.dialogue_clip;
      expect(compacted?.range.startUs).toBe(0);
      expect(compacted?.range.durationUs).toBeLessThan(600_000);
      expect(session.transaction.canUndo).toBe(true);
      session.transaction.undo();
      expect(session.getSnapshot().project?.items.dialogue_clip?.range.durationUs).toBe(1_000_000);
    } finally {
      await session.dispose();
    }
  });

  it('applies bounded loudness gain and a zero-latency limiter across sequential blocks', async () => {
    const source = constantAudioProvider({ audio_asset: 0.1 });
    const session = new AelionSession({ media: source });
    await session.loadProject(audioProject());
    try {
      const ir = session.getSnapshot().renderIr;
      if (ir === null) throw new Error('Missing Render IR');
      const renderer = await createMasteredAudioRenderer({
        ir,
        source,
        processing: {
          targetLufs: -3,
          maximumGainDb: 24,
          limiter: { ceilingDbtp: -6, lookaheadUs: 0, releaseUs: 0 },
        },
      });
      expect(renderer.report.appliedGainDb).toBeGreaterThan(10);
      const first = await renderer.render({
        startFrame: 0,
        frameCount: 64,
        channelCount: 1,
      });
      const second = await renderer.render({
        startFrame: 64,
        frameCount: 64,
        channelCount: 1,
      });
      const ceiling = 10 ** (-6 / 20);
      expect(Math.max(...first, ...second)).toBeLessThanOrEqual(ceiling + 1e-6);
      await expect(
        renderer.render({ startFrame: 129, frameCount: 1, channelCount: 1 }),
      ).rejects.toThrow('sequentially');
    } finally {
      await session.dispose();
    }
  });

  it('ducks only selected program stems without shifting the first sample', async () => {
    const builder = createProject({
      projectId: 'duck_project',
      sequenceId: 'duck_sequence',
      durationUs: seconds(1),
      channelLayout: 'mono',
    });
    builder.addAsset({ id: 'music_asset', kind: 'audio' });
    builder.addAsset({ id: 'voice_asset', kind: 'audio' });
    const musicTrack = builder.addTrack({ id: 'music', kind: 'audio' });
    const voiceTrack = builder.addTrack({ id: 'voice', kind: 'audio' });
    builder.addMediaClip({
      id: 'music_clip',
      kind: 'audio',
      assetId: 'music_asset',
      trackId: musicTrack,
      durationUs: seconds(1),
    });
    builder.addMediaClip({
      id: 'voice_clip',
      kind: 'audio',
      assetId: 'voice_asset',
      trackId: voiceTrack,
      durationUs: seconds(1),
    });
    const source = constantAudioProvider({ music_asset: 0.5, voice_asset: 1 });
    const session = new AelionSession({ media: source });
    await session.loadProject(builder.build());
    try {
      const ir = session.getSnapshot().renderIr;
      if (ir === null) throw new Error('Missing Render IR');
      const renderer = await createMasteredAudioRenderer({
        ir,
        source,
        processing: {
          ducking: [
            {
              programTrackIds: [musicTrack],
              sidechainTrackIds: [voiceTrack],
              thresholdDb: -40,
              reductionDb: -20,
              attackUs: 0,
              releaseUs: 0,
              lookaheadUs: 0,
            },
          ],
        },
      });
      const output = await renderer.render({
        startFrame: 0,
        frameCount: 2,
        channelCount: 1,
      });
      // The mono mixer normalizes each source to 0.5. Ducking reduces only
      // the music stem by 20 dB: 0.5 voice + 0.05 music, from frame zero.
      expect(output[0]).toBeCloseTo(0.55, 5);
      expect(output[1]).toBeCloseTo(0.55, 5);
    } finally {
      await session.dispose();
    }
  });
});
