import {
  LOCAL_RGBA8_COLOR_CAPABILITY,
  preflightColorPipeline,
  validateColorPipelineContract,
  type RenderIr,
} from '@aelionsdk/render-ir';
import { describe, expect, it } from 'vitest';

function ir(overrides: Partial<RenderIr> = {}): RenderIr {
  return {
    irVersion: '1.0.0',
    projectId: 'color',
    sequenceId: 'sequence',
    revision: 0n,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    sampleRate: 48_000,
    channelLayout: 'stereo',
    workingColorSpace: 'srgb-linear',
    colorPrimaries: 'bt709',
    transferFunction: 'srgb',
    matrixCoefficients: 'rgb',
    colorRange: 'full',
    chromaSubsampling: '4:4:4',
    alphaMode: 'premultiplied',
    toneMapping: 'none',
    bitDepth: 8,
    durationUs: 1_000_000,
    tracks: [],
    transitions: [],
    materials: {},
    ...overrides,
  };
}

describe('color pipeline contract', () => {
  it('accepts SDR/P3/Rec.2020 contracts and fail-closes unsupported local HDR output', () => {
    const p3 = ir({
      workingColorSpace: 'display-p3-linear',
      colorPrimaries: 'display-p3',
    });
    validateColorPipelineContract(p3);
    expect(preflightColorPipeline(p3, LOCAL_RGBA8_COLOR_CAPABILITY).ok).toBe(false);
    const hdr = ir({
      workingColorSpace: 'rec2020-linear',
      colorPrimaries: 'bt2020',
      transferFunction: 'pq',
      bitDepth: 10,
    });
    expect(() => validateColorPipelineContract(hdr)).not.toThrow();
    const report = preflightColorPipeline(hdr, LOCAL_RGBA8_COLOR_CAPABILITY);
    expect(report.ok).toBe(false);
    expect(report.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        'COLOR_TRANSFER_FUNCTION_UNSUPPORTED',
        'COLOR_BIT_DEPTH_UNSUPPORTED',
        'COLOR_HDR_PRESENTATION_UNSUPPORTED',
      ]),
    );
  });

  it('rejects invalid HDR contracts before rendering or export', () => {
    expect(() =>
      validateColorPipelineContract(
        ir({
          workingColorSpace: 'display-p3-linear',
          colorPrimaries: 'display-p3',
          transferFunction: 'hlg',
          bitDepth: 8,
        }),
      ),
    ).toThrow('COLOR_HDR_REQUIRES_REC2020');
  });
});
