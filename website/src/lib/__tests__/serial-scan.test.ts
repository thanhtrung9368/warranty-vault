import { describe, expect, it } from 'vitest';
import {
  BARCODE_FORMATS,
  MAX_SCANNED_SERIAL_CHARS,
  classifyCameraError,
  hasBarcodeDetector,
  isDetectorFormatError,
  isDetectorMiss,
  normalizeScannedSerial,
  resolveScanFormats,
  supportsSerialScan,
} from '@/lib/serial-scan';

// `serial-scan.ts` is the pure half of the camera feature. The browser APIs it
// prepares for (`getUserMedia`, `BarcodeDetector`) cannot run in this test
// environment, so these tests pin the decisions instead: which browsers get the
// button, which formats we ask for, what a decoded payload becomes, and which
// error a camera rejection maps to.

const getUserMedia = () => Promise.resolve({} as MediaStream);

function browser(overrides: Record<string, unknown> = {}) {
  return {
    BarcodeDetector: function BarcodeDetector() {},
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia } },
    ...overrides,
  };
}

describe('barcode formats', () => {
  it('asks for exactly the formats that matter on device labels', () => {
    expect([...BARCODE_FORMATS]).toEqual([
      'code_128',
      'ean_13',
      'ean_8',
      'qr_code',
      'data_matrix',
    ]);
  });

  it('keeps the full list when the browser cannot report supported formats', () => {
    expect(resolveScanFormats(undefined)).toEqual([...BARCODE_FORMATS]);
    expect(resolveScanFormats(null)).toEqual([...BARCODE_FORMATS]);
  });

  it('narrows to the intersection, preserving our order', () => {
    expect(resolveScanFormats(['qr_code', 'ean_13'])).toEqual([
      'ean_13',
      'qr_code',
    ]);
    expect(resolveScanFormats(['code_39', 'pdf417'])).toEqual([]);
  });

  it('treats an explicitly empty supported list as "can decode nothing"', () => {
    // This is not the same answer as "the helper is missing" — an empty list
    // must stop the caller before it constructs a detector.
    expect(resolveScanFormats([])).toEqual([]);
  });
});

describe('feature detection', () => {
  it('requires the property to exist and be a constructor function', () => {
    expect(hasBarcodeDetector({ BarcodeDetector: function () {} })).toBe(true);
    expect(hasBarcodeDetector({ BarcodeDetector: undefined })).toBe(false);
    expect(hasBarcodeDetector({})).toBe(false);
    expect(hasBarcodeDetector(null)).toBe(false);
    expect(hasBarcodeDetector('BarcodeDetector')).toBe(false);
  });

  it('offers scanning only when detector, secure context and camera all exist', () => {
    expect(supportsSerialScan(browser())).toBe(true);
  });

  it('refuses Safari/Firefox, where BarcodeDetector is absent', () => {
    const safari = browser({ BarcodeDetector: undefined });
    expect(supportsSerialScan(safari)).toBe(false);
  });

  it('refuses an insecure origin, even if the API is present', () => {
    expect(supportsSerialScan(browser({ isSecureContext: false }))).toBe(false);
    expect(supportsSerialScan(browser({ isSecureContext: undefined }))).toBe(false);
  });

  it('refuses a detector that has no camera access', () => {
    expect(
      supportsSerialScan(browser({ navigator: { mediaDevices: {} } })),
    ).toBe(false);
    expect(supportsSerialScan(browser({ navigator: undefined }))).toBe(false);
  });
});

describe('normalizeScannedSerial', () => {
  it('accepts an IMEI and removes grouping spaces', () => {
    expect(normalizeScannedSerial('356938 035643 809')).toEqual({
      ok: true,
      value: '356938035643809',
    });
  });

  it('strips a leading IMEI / S/N / Serial label', () => {
    expect(normalizeScannedSerial('IMEI: 356938035643809')).toEqual({
      ok: true,
      value: '356938035643809',
    });
    expect(normalizeScannedSerial('S/N: C02X1234JGH5')).toEqual({
      ok: true,
      value: 'C02X1234JGH5',
    });
    expect(normalizeScannedSerial('Serial number - SN-0001')).toEqual({
      ok: true,
      value: 'SN-0001',
    });
  });

  it('takes the first non-empty line of a multi-line QR payload', () => {
    expect(
      normalizeScannedSerial('\n  \nIMEI: 356938035643809\nWarranty: 12 months'),
    ).toEqual({ ok: true, value: '356938035643809' });
  });

  it('drops zero-width characters and normalises full-width digits', () => {
    expect(normalizeScannedSerial('356\u200b938\u200d035643809')).toEqual({
      ok: true,
      value: '356938035643809',
    });
    expect(normalizeScannedSerial('３５６９３８０３５６４３８０９')).toEqual({
      ok: true,
      value: '356938035643809',
    });
  });

  it('preserves case and punctuation that may be part of a manufacturer serial', () => {
    expect(normalizeScannedSerial(' c02x-1234/jgh5 ')).toEqual({
      ok: true,
      value: 'c02x-1234/jgh5',
    });
  });

  it('rejects an empty payload rather than returning an empty draft', () => {
    expect(normalizeScannedSerial('')).toEqual({
      ok: false,
      reason: 'empty',
      length: 0,
    });
    expect(normalizeScannedSerial('  \n\t ')).toEqual({
      ok: false,
      reason: 'empty',
      length: 0,
    });
    expect(normalizeScannedSerial('IMEI: ')).toEqual({
      ok: false,
      reason: 'empty',
      length: 0,
    });
  });

  it('rejects a QR that carries a URL instead of a serial', () => {
    const url = 'https://example.com/warranty/123';
    expect(normalizeScannedSerial(url)).toEqual({
      ok: false,
      reason: 'url',
      length: url.length,
    });
    expect(normalizeScannedSerial('www.example.com/abc').ok).toBe(false);
  });

  it('rejects a payload longer than the OCR serial ceiling', () => {
    const long = 'A'.repeat(MAX_SCANNED_SERIAL_CHARS + 1);
    expect(normalizeScannedSerial(long)).toEqual({
      ok: false,
      reason: 'too-long',
      length: MAX_SCANNED_SERIAL_CHARS + 1,
    });
    expect(normalizeScannedSerial('A'.repeat(MAX_SCANNED_SERIAL_CHARS))).toEqual({
      ok: true,
      value: 'A'.repeat(MAX_SCANNED_SERIAL_CHARS),
    });
  });
});

describe('camera errors', () => {
  it('maps permission denial', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('permission');
    expect(classifyCameraError({ name: 'SecurityError' })).toBe('permission');
    expect(classifyCameraError({ name: 'PermissionDeniedError' })).toBe('permission');
  });

  it('maps a missing camera or unsatisfiable constraint', () => {
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('not-found');
    expect(classifyCameraError({ name: 'DevicesNotFoundError' })).toBe('not-found');
    expect(classifyCameraError({ name: 'OverconstrainedError' })).toBe('not-found');
  });

  it('maps a camera already in use', () => {
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('busy');
    expect(classifyCameraError({ name: 'TrackStartError' })).toBe('busy');
    expect(classifyCameraError({ name: 'AbortError' })).toBe('busy');
  });

  it('falls back to unknown for anything else, without throwing', () => {
    expect(classifyCameraError({ name: 'WeirdError' })).toBe('unknown');
    expect(classifyCameraError(null)).toBe('unknown');
    expect(classifyCameraError('nope')).toBe('unknown');
  });

  it('recognises the detector "nothing in frame" signal', () => {
    expect(isDetectorMiss({ name: 'NotFoundException' })).toBe(true);
    expect(isDetectorMiss({ name: 'NotFoundError' })).toBe(true);
    expect(isDetectorMiss({ name: 'NotAllowedError' })).toBe(false);
    expect(isDetectorMiss(undefined)).toBe(false);
  });

  it('recognises a detector that rejects an unsupported format on detect()', () => {
    expect(isDetectorFormatError({ name: 'NotSupportedError' })).toBe(true);
    expect(isDetectorFormatError({ name: 'TypeError' })).toBe(true);
    expect(isDetectorFormatError({ name: 'NotFoundException' })).toBe(false);
    expect(isDetectorFormatError(null)).toBe(false);
  });
});
