import { describe, expect, it } from 'vitest';

import { createProject } from '../src/project-builder.js';
import {
  alignCueToSilenceUs,
  exportSubtitleTrack,
  frameRangeToUs,
  importSubtitleTrack,
  type SubtitleCue,
} from '../src/subtitle-io.js';

function captionTrack(builder: ReturnType<typeof createProject>): string {
  return builder.addTrack({ kind: 'caption', name: 'Subtitles' });
}

const SRT = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:05,000 --> 00:00:07,000
Second cue
`;

describe('importSubtitleTrack', () => {
  it('imports an SRT document into caption clips', () => {
    const builder = createProject({ sequenceId: 'main', width: 1920, height: 1080 });
    const trackId = captionTrack(builder);
    const result = importSubtitleTrack(builder, { trackId, text: SRT, format: 'srt' });
    expect(result.cueCount).toBe(2);
    expect(result.warnings).toEqual([]);

    const project = builder.build();
    const captionItems = Object.values(project.items).filter(item => item.type === 'caption');
    expect(captionItems).toHaveLength(2);
    expect(captionItems[0]).toMatchObject({
      type: 'caption',
      range: { startUs: 1_000_000, durationUs: 2_000_000 },
      text: 'Hello world',
    });
    expect(captionItems[1]).toMatchObject({
      range: { startUs: 5_000_000, durationUs: 2_000_000 },
      text: 'Second cue',
    });
  });

  it('imports a WebVTT document preserving cue settings', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000 position:10% line:90%\nStyled cue\n`;
    const result = importSubtitleTrack(builder, { trackId, text: vtt, format: 'vtt' });
    expect(result.cueCount).toBe(1);
    const project = builder.build();
    const item = Object.values(project.items).find(item => item.type === 'caption');
    expect(item?.cueSettings).toEqual({ position: '10%', line: '90%' });
  });

  it('fails closed on overlapping imported cues', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    const overlapping = `1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:02,000 --> 00:00:04,000\nOverlaps\n`;
    expect(() =>
      importSubtitleTrack(builder, { trackId, text: overlapping, format: 'srt' }),
    ).toThrow(/CAPTION_IMPORT_OVERLAP/);
    expect(Object.keys(builder.build().items)).toHaveLength(0);
  });

  it('offsets all cues with atUs and preserves duration after silence alignment', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    importSubtitleTrack(builder, {
      trackId,
      text: SRT,
      format: 'srt',
      atUs: 2_000_000,
      alignToSilence: [{ startUs: 2_900_000, durationUs: 300_000 }],
    });
    const first = Object.values(builder.build().items).find(item => item.type === 'caption');
    expect(first?.range).toEqual({ startUs: 3_200_000, durationUs: 2_000_000 });
  });

  it('aligns cues away from silent ranges', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    // The first SRT cue starts at 1.0s; a silent range covering its start moves it to 1.2s.
    const silence = [{ startUs: 800_000, durationUs: 400_000 }];
    const result = importSubtitleTrack(builder, {
      trackId,
      text: SRT,
      format: 'srt',
      alignToSilence: silence,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    const project = builder.build();
    const item = Object.values(project.items).find(item => item.type === 'caption');
    expect(item?.range.startUs).toBe(1_200_000);
  });
});

describe('exportSubtitleTrack', () => {
  it('round-trips an SRT import back to equivalent SRT', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    importSubtitleTrack(builder, { trackId, text: SRT, format: 'srt' });
    const project = builder.build();
    const result = exportSubtitleTrack(project, trackId, 'srt');
    expect(result.cueCount).toBe(2);
    expect(result.text).toContain('Hello world');
    expect(result.text).toContain('Second cue');
    expect(result.text).toContain('00:00:01,000 --> 00:00:03,000');
  });

  it('exports to WebVTT with settings', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    const vtt = `WEBVTT\n\ncue1\n00:00:01.000 --> 00:00:03.000 position:10% line:90%\nStyled\n`;
    importSubtitleTrack(builder, { trackId, text: vtt, format: 'vtt' });
    const project = builder.build();
    const result = exportSubtitleTrack(project, trackId, 'vtt');
    expect(result.text.startsWith('WEBVTT')).toBe(true);
    expect(result.text).toContain('position:10%');
    expect(result.text).toContain('line:90%');
  });

  it('rejects a non-caption track', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = builder.addTrack({ kind: 'visual' });
    const project = builder.build();
    expect(() => exportSubtitleTrack(project, trackId, 'srt')).toThrow(/caption Track/);
  });

  it('fails closed when the caption track contains overlapping clips', () => {
    const builder = createProject({ sequenceId: 'main' });
    const trackId = captionTrack(builder);
    builder.addCaptionClip({ trackId, text: 'one', atUs: 0, durationUs: 2_000_000 });
    builder.addCaptionClip({ trackId, text: 'two', atUs: 1_000_000, durationUs: 2_000_000 });
    expect(() => exportSubtitleTrack(builder.build(), trackId, 'vtt')).toThrow(
      /CAPTION_EXPORT_OVERLAP/,
    );
  });
});

describe('subtitle alignment helpers', () => {
  const cue: SubtitleCue = { startUs: 1_000_000, endUs: 3_000_000, text: 'cue' };

  it('returns 0 shift when the cue start is on audible audio', () => {
    const silence = [{ startUs: 500_000, durationUs: 100_000 }];
    expect(alignCueToSilenceUs(cue, silence)).toBe(0);
  });

  it('shifts a cue whose start falls inside silence to its end', () => {
    const silence = [{ startUs: 900_000, durationUs: 500_000 }];
    expect(alignCueToSilenceUs(cue, silence)).toBe(400_000);
  });

  it('converts audio frames to microseconds', () => {
    expect(frameRangeToUs(0, 48_000, 48_000)).toEqual({ startUs: 0, durationUs: 1_000_000 });
    expect(frameRangeToUs(48_000, 24_000, 48_000)).toEqual({
      startUs: 1_000_000,
      durationUs: 500_000,
    });
  });
});
