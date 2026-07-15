import type { Diagnostic } from '@aelion/core';

import type { RenderIr } from './types.js';

export type IrTransferFunction = 'srgb' | 'gamma22' | 'pq' | 'hlg';
export type IrOutputBitDepth = 8 | 10;

export interface ColorPipelineCapability {
  readonly workingColorSpaces: ReadonlySet<string>;
  readonly transferFunctions: ReadonlySet<IrTransferFunction>;
  readonly bitDepths: ReadonlySet<IrOutputBitDepth>;
  readonly hdrPresentation: boolean;
}

export interface ColorPipelineReport {
  readonly ok: boolean;
  readonly issues: readonly Diagnostic[];
}

export function validateColorPipelineContract(ir: RenderIr): void {
  const transfer = ir.transferFunction ?? 'srgb';
  const bitDepth = ir.bitDepth ?? 8;
  if ((transfer === 'pq' || transfer === 'hlg') && ir.workingColorSpace !== 'rec2020-linear') {
    throw new TypeError('COLOR_HDR_REQUIRES_REC2020');
  }
  if ((transfer === 'pq' || transfer === 'hlg') && bitDepth !== 10) {
    throw new TypeError('COLOR_HDR_REQUIRES_10_BIT');
  }
}

export function preflightColorPipeline(
  ir: RenderIr,
  capability: ColorPipelineCapability,
): ColorPipelineReport {
  validateColorPipelineContract(ir);
  const issues: Diagnostic[] = [];
  const transfer = ir.transferFunction ?? 'srgb';
  const bitDepth = ir.bitDepth ?? 8;
  if (!capability.workingColorSpaces.has(ir.workingColorSpace)) {
    issues.push({
      code: 'COLOR_WORKING_SPACE_UNSUPPORTED',
      severity: 'error',
      message: `Working color space ${ir.workingColorSpace} is unavailable`,
      recoverable: true,
    });
  }
  if (!capability.transferFunctions.has(transfer)) {
    issues.push({
      code: 'COLOR_TRANSFER_FUNCTION_UNSUPPORTED',
      severity: 'error',
      message: `Transfer function ${transfer} is unavailable`,
      recoverable: true,
    });
  }
  if (!capability.bitDepths.has(bitDepth)) {
    issues.push({
      code: 'COLOR_BIT_DEPTH_UNSUPPORTED',
      severity: 'error',
      message: `${bitDepth.toString()}-bit output is unavailable`,
      recoverable: true,
    });
  }
  if ((transfer === 'pq' || transfer === 'hlg') && !capability.hdrPresentation) {
    issues.push({
      code: 'COLOR_HDR_PRESENTATION_UNSUPPORTED',
      severity: 'error',
      message: 'The active output surface cannot present HDR',
      recoverable: true,
    });
  }
  return { ok: issues.length === 0, issues };
}

export const LOCAL_RGBA8_COLOR_CAPABILITY: ColorPipelineCapability = {
  workingColorSpaces: new Set(['srgb-linear', 'display-p3-linear', 'rec2020-linear']),
  transferFunctions: new Set(['srgb', 'gamma22']),
  bitDepths: new Set([8]),
  hdrPresentation: false,
};
