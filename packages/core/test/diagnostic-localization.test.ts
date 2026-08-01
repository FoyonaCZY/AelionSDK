import { describe, expect, it } from 'vitest';

import {
  defaultDiagnosticCatalog,
  localizeDiagnostic,
  localizeDiagnostics,
  type Diagnostic,
} from '../src/index.js';

function diagnostic(code: string, message: string, details?: Diagnostic['details']): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    recoverable: false,
    ...(details === undefined ? {} : { details }),
  };
}

describe('localizeDiagnostic', () => {
  it('interpolates detail parameters into the locale template', () => {
    const input = diagnostic(
      'PROJECT_REFERENCE_MISSING',
      'Reference asset_missing does not exist in assets',
      { id: 'asset_missing', collection: 'assets' },
    );
    const localized = localizeDiagnostic(input, defaultDiagnosticCatalog, 'en');
    expect(localized.message).toBe('Reference asset_missing does not exist in assets');
    expect(localized.code).toBe('PROJECT_REFERENCE_MISSING');
    expect(localized.severity).toBe('error');
    expect(localized.recoverable).toBe(false);
  });

  it('renders missing detail parameters as empty strings', () => {
    const input = diagnostic('PROJECT_REFERENCE_MISSING', 'original', { id: 'only_id' });
    const localized = localizeDiagnostic(input, defaultDiagnosticCatalog, 'en');
    expect(localized.message).toBe('Reference only_id does not exist in ');
  });

  it('returns the original diagnostic unchanged when the code has no template', () => {
    const input = diagnostic('SOME_UNKNOWN_CODE', 'Keep me verbatim');
    const localized = localizeDiagnostic(input, defaultDiagnosticCatalog, 'en');
    expect(localized).toBe(input);
  });

  it('returns the original message when the locale has no template for the code', () => {
    const input = diagnostic('PROJECT_MATERIAL_ORPHAN', 'Material instance mat_x has no owner');
    const localized = localizeDiagnostic(input, defaultDiagnosticCatalog, 'zh-CN');
    expect(localized.message).toBe('Material instance mat_x has no owner');
  });

  it('uses a caller-provided locale template', () => {
    const input = diagnostic('PROJECT_MATERIAL_ORPHAN', 'original', { id: 'mat_x' });
    const catalog = {
      PROJECT_MATERIAL_ORPHAN: { 'zh-CN': '素材实例 {id} 没有宿主' },
    };
    const localized = localizeDiagnostic(input, catalog, 'zh-CN');
    expect(localized.message).toBe('素材实例 mat_x 没有宿主');
  });
});

describe('localizeDiagnostics', () => {
  it('localizes every diagnostic and passes through unknown codes', () => {
    const known = diagnostic('OPERATION_ABORTED', 'original', { operation: 'decode' });
    const unknown = diagnostic('X_UNKNOWN', 'verbatim');
    const result = localizeDiagnostics([known, unknown], defaultDiagnosticCatalog, 'en');
    expect(result[0]?.message).toBe('decode was aborted');
    expect(result[1]).toBe(unknown);
  });
});
