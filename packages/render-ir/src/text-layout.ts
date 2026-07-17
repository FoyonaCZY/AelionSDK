import type { JsonObject } from '@aelion/core';

import type { IrTextClip, IrTextRun } from './types.js';

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

function graphemes(value: string): readonly string[] {
  return Array.from(graphemeSegmenter.segment(value), segment => segment.segment);
}

export interface IrLaidOutTextSpan {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly advancePx: number;
  readonly glyphs: readonly IrLaidOutTextGlyph[];
  readonly style: PortableTextStyle;
}

export interface IrLaidOutTextGlyph {
  readonly text: string;
  readonly x: number;
  readonly advancePx: number;
}

export interface IrLaidOutTextLine {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly spans: readonly IrLaidOutTextSpan[];
}

export interface IrTextLayout {
  readonly metricsId: 'aelion-portable-text-metrics/1';
  readonly fontSizePx: number;
  readonly overflowed: boolean;
  readonly lines: readonly IrLaidOutTextLine[];
}

export interface PortableTextStyle {
  readonly fontFamilies: readonly string[];
  readonly fontSizePx: number;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic' | 'oblique';
  readonly lineHeightPx: number;
  readonly letterSpacingPx: number;
  readonly fill: string;
  readonly stroke: string | undefined;
  readonly strokeWidthPx: number;
  readonly align: 'start' | 'center' | 'end';
  readonly direction: 'ltr' | 'rtl';
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function portableTextStyle(
  runStyle: JsonObject,
  paragraphStyle: JsonObject = {},
  scale = 1,
): PortableTextStyle {
  const combined = { ...paragraphStyle, ...runStyle } as Readonly<Record<string, unknown>>;
  const families = Array.isArray(combined.fontFamilies)
    ? combined.fontFamilies.filter((value): value is string => typeof value === 'string')
    : [text(combined.fontFamily, 'sans-serif')];
  const fontSizePx = Math.max(1, finite(combined.fontSizePx, 32) * scale);
  const fontStyle = text(combined.fontStyle, 'normal');
  const align = text(combined.align, 'start');
  const direction = text(combined.direction, 'ltr');
  return {
    fontFamilies: families.length === 0 ? ['sans-serif'] : families,
    fontSizePx,
    fontWeight: Math.max(1, Math.min(1_000, finite(combined.fontWeight, 400))),
    fontStyle: fontStyle === 'italic' || fontStyle === 'oblique' ? fontStyle : ('normal' as const),
    lineHeightPx: Math.max(fontSizePx, finite(combined.lineHeightPx, fontSizePx * 1.2) * scale),
    letterSpacingPx: finite(combined.letterSpacingPx, 0) * scale,
    fill: text(combined.fill, '#ffffff'),
    stroke: typeof combined.stroke === 'string' ? combined.stroke : undefined,
    strokeWidthPx: Math.max(0, finite(combined.strokeWidthPx, 0) * scale),
    align: align === 'center' || align === 'end' ? align : 'start',
    direction: direction === 'rtl' ? 'rtl' : 'ltr',
  };
}

export function portableGlyphAdvance(character: string, style: PortableTextStyle): number {
  const codePoint = character.codePointAt(0) ?? 0;
  const em =
    character === ' '
      ? 0.33
      : codePoint >= 0x2e80 || codePoint > 0xffff
        ? 1
        : /[ilI1.,'`]/u.test(character)
          ? 0.32
          : /[MW@#%]/u.test(character)
            ? 0.9
            : 0.6;
  return style.fontSizePx * em + style.letterSpacingPx;
}

function runTokens(run: IrTextRun): readonly string[] {
  return run.text
    .split(/(\r?\n|[\t ]+|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)
    .filter(Boolean);
}

function tokenAdvance(token: string, style: PortableTextStyle): number {
  return graphemes(token).reduce(
    (total, character) => total + portableGlyphAdvance(character, style),
    0,
  );
}

function lineOffset(
  width: number,
  boxWidth: number,
  align: PortableTextStyle['align'],
  direction: PortableTextStyle['direction'],
): number {
  if (align === 'center') return (boxWidth - width) / 2;
  if (align === 'end') return direction === 'rtl' ? 0 : boxWidth - width;
  return direction === 'rtl' ? boxWidth - width : 0;
}

function laidOutSpan(
  value: string,
  x: number,
  y: number,
  style: PortableTextStyle,
): IrLaidOutTextSpan {
  let cursor = x;
  const glyphs = graphemes(value).map(character => {
    const advancePx = portableGlyphAdvance(character, style);
    const glyph = { text: character, x: cursor, advancePx };
    cursor += advancePx;
    return glyph;
  });
  return { text: value, x, y, advancePx: cursor - x, glyphs, style };
}

function layoutAtScale(clip: IrTextClip, scale: number): IrTextLayout {
  const lines: IrLaidOutTextLine[] = [];
  let cursorY = clip.box.y;
  let current: IrLaidOutTextSpan[] = [];
  let width = 0;
  let height = 0;
  let align: PortableTextStyle['align'] = 'start';
  let direction: PortableTextStyle['direction'] = 'ltr';
  let overflowed = false;
  const flush = (): void => {
    if (current.length === 0 && height === 0) return;
    const offset = lineOffset(width, clip.box.width, align, direction);
    let rtlCursor = clip.box.x + width;
    const positioned = current.map(span => {
      if (direction !== 'rtl') return span;
      rtlCursor -= span.advancePx;
      const shift = rtlCursor - span.x;
      return {
        ...span,
        x: rtlCursor,
        glyphs: span.glyphs.map(glyph => ({ ...glyph, x: glyph.x + shift })),
      };
    });
    lines.push({
      x: clip.box.x + offset,
      y: cursorY,
      width,
      height,
      spans: positioned.map(span => ({
        ...span,
        x: span.x + offset,
        glyphs: span.glyphs.map(glyph => ({ ...glyph, x: glyph.x + offset })),
      })),
    });
    cursorY += height;
    current = [];
    width = 0;
    height = 0;
  };
  for (const paragraph of clip.paragraphs) {
    for (const run of paragraph.runs) {
      const style = portableTextStyle(run.style, paragraph.style, scale);
      for (const token of runTokens(run)) {
        if (token === '\n' || token === '\r\n') {
          flush();
          continue;
        }
        if (current.length === 0) {
          align = style.align;
          direction = style.direction;
        }
        const advance = tokenAdvance(token, style);
        if (width > 0 && width + advance > clip.box.width && token.trim().length > 0) flush();
        if (cursorY + Math.max(height, style.lineHeightPx) > clip.box.y + clip.box.height) {
          overflowed = true;
        }
        current.push(laidOutSpan(token, clip.box.x + width, cursorY, style));
        width += advance;
        height = Math.max(height, style.lineHeightPx);
      }
    }
    flush();
  }
  if (clip.overflow === 'ellipsis' && overflowed) {
    const last = lines.findLast(line => line.y + line.height <= clip.box.y + clip.box.height);
    if (last !== undefined && last.spans.length > 0) {
      const spans = last.spans.slice();
      const tail = spans.at(-1);
      if (tail !== undefined) {
        const replacement = laidOutSpan(`${tail.text.trimEnd()}…`, tail.x, tail.y, tail.style);
        spans[spans.length - 1] = replacement;
      }
      const index = lines.indexOf(last);
      lines.splice(index, lines.length - index, { ...last, spans });
    }
  }
  return {
    metricsId: 'aelion-portable-text-metrics/1',
    fontSizePx: 32 * scale,
    overflowed,
    lines,
  };
}

/** Deterministic, host-independent line breaking used by Preview and Export. */
export function layoutIrText(clip: IrTextClip): IrTextLayout {
  if (clip.writingMode !== 'horizontal-tb') {
    // Portable vertical fallback treats each grapheme as a line. It remains
    // deterministic and preserves content when native vertical shaping is unavailable.
    const vertical = {
      ...clip,
      paragraphs: clip.paragraphs.map(paragraph => ({
        ...paragraph,
        runs: paragraph.runs.map(run => ({ ...run, text: graphemes(run.text).join('\n') })),
      })),
    };
    return layoutAtScale(vertical, 1);
  }
  let result = layoutAtScale(clip, 1);
  if (clip.overflow !== 'auto-fit' || !result.overflowed) return result;
  let low = 0.25;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration++) {
    const middle = (low + high) / 2;
    const candidate = layoutAtScale(clip, middle);
    if (candidate.overflowed) high = middle;
    else {
      low = middle;
      result = candidate;
    }
  }
  return result;
}
