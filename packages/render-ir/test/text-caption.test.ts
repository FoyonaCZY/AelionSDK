import {
  layoutIrText,
  parseSrt,
  parseWebVtt,
  serializeSrt,
  serializeWebVtt,
  type IrTextClip,
} from '@aelion/render-ir';
import { describe, expect, it } from 'vitest';

function textClip(overrides: Partial<IrTextClip> = {}): IrTextClip {
  return {
    id: 'title',
    trackId: 'titles',
    kind: 'text-clip',
    role: 'text',
    range: { startUs: 0, durationUs: 1_000_000 },
    enabled: true,
    materialInstanceIds: [],
    dependencyEntityIds: ['title'],
    fingerprint: 'title',
    box: { x: 10, y: 20, width: 120, height: 100 },
    overflow: 'clip',
    writingMode: 'horizontal-tb',
    paragraphs: [
      {
        style: { align: 'center' },
        runs: [
          {
            text: 'one two three four',
            style: { fontSizePx: 20, fill: '#ffffff' },
          },
        ],
      },
    ],
    visual: {
      fit: 'none',
      transform: {
        positionPx: { x: 60, y: 50 },
        anchor: { x: 0.5, y: 0.5 },
        scale: { x: 1, y: 1 },
        rotationDeg: 0,
        skewDeg: { x: 0, y: 0 },
      },
      crop: {},
      opacity: 1,
      blendMode: 'normal',
    },
    ...overrides,
  };
}

describe('portable text layout', () => {
  it('breaks lines deterministically and applies alignment without host font metrics', () => {
    const first = layoutIrText(textClip());
    const second = layoutIrText(textClip());
    expect(first).toEqual(second);
    expect(first.metricsId).toBe('aelion-portable-text-metrics/1');
    expect(first.lines.length).toBeGreaterThan(1);
    expect(first.lines.every(line => line.x >= 10 && line.width <= 120)).toBe(true);
  });

  it('auto-fits overflow and preserves vertical text through a deterministic fallback', () => {
    const fitted = layoutIrText(
      textClip({ box: { x: 0, y: 0, width: 80, height: 25 }, overflow: 'auto-fit' }),
    );
    expect(fitted.fontSizePx).toBeLessThan(32);
    expect(fitted.overflowed).toBe(false);
    const vertical = layoutIrText(
      textClip({
        writingMode: 'vertical-rl',
        paragraphs: [{ style: {}, runs: [{ text: '字幕', style: { fontSizePx: 20 } }] }],
      }),
    );
    expect(vertical.lines.flatMap(line => line.spans).map(span => span.text)).toEqual(['字', '幕']);
  });
});

describe('SRT and WebVTT adapters', () => {
  it('round-trips Unicode cue timing and text through SRT', () => {
    const input = '1\n00:00:01,250 --> 00:00:03,500\n你好\nworld\n';
    const cues = parseSrt(input);
    expect(cues).toEqual([{ id: '1', startUs: 1_250_000, endUs: 3_500_000, text: '你好\nworld' }]);
    expect(parseSrt(serializeSrt(cues).text)[0]).toMatchObject({
      startUs: 1_250_000,
      endUs: 3_500_000,
      text: '你好\nworld',
    });
  });

  it('preserves WebVTT cue settings and reports SRT style degradation', () => {
    const input = 'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000 line:90% align:center\nCaption';
    const cues = parseWebVtt(input);
    expect(cues[0]?.settings).toEqual({ line: '90%', align: 'center' });
    expect(parseWebVtt(serializeWebVtt(cues).text)).toEqual(cues);
    expect(serializeSrt(cues).warnings).toHaveLength(1);
  });
});
