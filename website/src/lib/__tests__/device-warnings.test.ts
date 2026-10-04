import { describe, it, expect } from 'vitest';
import {
  DEVICE_WARNING_TITLES,
  MAX_DEVICE_WARNINGS,
  MAX_DEVICE_WARNING_MESSAGE_CHARS,
  MAX_WARNINGS_FLASH_BYTES,
  decodeDeviceWarningsFlash,
  deviceWarningFieldLabel,
  deviceWarningMessages,
  deviceWarningSummary,
  deviceWarningTitle,
  encodeDeviceWarningsFlash,
  hasDeviceWarnings,
  normalizeDeviceWarnings,
  warningsForDevice,
} from '@/lib/device-warnings';

// `warnings` on POST/PATCH /v1/devices and on the AI draft. Non-blocking by
// contract: the device IS saved, so nothing here may look like a rejection.

const IMEI_WARNING = {
  code: 'IMEI_CHECKSUM',
  field: 'serialNumber',
  message:
    '15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số. Vẫn lưu được, nhưng nên đối chiếu lại với tem máy hoặc hoá đơn trước khi đi bảo hành.',
};

const DUPLICATE_WARNING = {
  code: 'SERIAL_DUPLICATE',
  field: 'serialNumber',
  message:
    'Số serial/IMEI này đã có ở 2 thiết bị khác trong tài khoản của bạn. Kiểm tra để tránh trùng hồ sơ bảo hành.',
};

describe('normalizeDeviceWarnings', () => {
  it('passes the API payload through, message included', () => {
    expect(normalizeDeviceWarnings([IMEI_WARNING, DUPLICATE_WARNING])).toEqual([
      IMEI_WARNING,
      DUPLICATE_WARNING,
    ]);
  });

  it('returns [] for a missing / empty / non-array payload', () => {
    expect(normalizeDeviceWarnings(undefined)).toEqual([]);
    expect(normalizeDeviceWarnings(null)).toEqual([]);
    expect(normalizeDeviceWarnings([])).toEqual([]);
    expect(normalizeDeviceWarnings('oops')).toEqual([]);
    expect(normalizeDeviceWarnings({ code: 'IMEI_LENGTH' })).toEqual([]);
  });

  it('drops entries with no message rather than inventing one', () => {
    expect(
      normalizeDeviceWarnings([
        { code: 'IMEI_LENGTH', field: 'serialNumber', message: '   ' },
        { code: 'IMEI_LENGTH' },
        null,
        'nope',
        IMEI_WARNING,
      ]),
    ).toEqual([IMEI_WARNING]);
  });

  it('defaults a missing code/field instead of dropping a real message', () => {
    expect(normalizeDeviceWarnings([{ message: 'Có gì đó không ổn' }])).toEqual([
      { code: 'UNKNOWN', field: 'serialNumber', message: 'Có gì đó không ổn' },
    ]);
  });

  it('caps the count and the message length', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      code: 'IMEI_LENGTH',
      field: 'serialNumber',
      message: `cảnh báo ${i}`,
    }));
    expect(normalizeDeviceWarnings(many)).toHaveLength(MAX_DEVICE_WARNINGS);
    const huge = normalizeDeviceWarnings([
      { code: 'X', field: 'serialNumber', message: 'a'.repeat(5000) },
    ]);
    expect(huge[0].message).toHaveLength(MAX_DEVICE_WARNING_MESSAGE_CHARS);
  });
});

describe('titles and labels', () => {
  // Language pinned explicitly (docs/I18N_PLAN.md §4.3): these assertions are
  // about the Vietnamese source sentences, so they must not drift with the
  // locale of the machine running the suite.
  it('has a Vietnamese heading for every documented code', () => {
    expect(deviceWarningTitle('IMEI_CHECKSUM', 'vi')).toBe(DEVICE_WARNING_TITLES.IMEI_CHECKSUM);
    expect(deviceWarningTitle('IMEI_LENGTH', 'vi')).toBe(DEVICE_WARNING_TITLES.IMEI_LENGTH);
    expect(deviceWarningTitle('SERIAL_DUPLICATE', 'vi')).toBe(
      DEVICE_WARNING_TITLES.SERIAL_DUPLICATE,
    );
  });

  it('still renders an unknown code', () => {
    expect(deviceWarningTitle('SOMETHING_NEW', 'vi')).toBe('Cảnh báo số serial/IMEI');
    expect(deviceWarningTitle(null, 'vi')).toBe('Cảnh báo số serial/IMEI');
  });

  it('labels the field it points at', () => {
    expect(deviceWarningFieldLabel('serialNumber', 'vi')).toBe('Serial / IMEI');
    expect(deviceWarningFieldLabel('', 'vi')).toBe('Serial / IMEI');
  });
});

describe('messages / summary / has', () => {
  it('exposes the API messages verbatim and in order', () => {
    expect(deviceWarningMessages([IMEI_WARNING, DUPLICATE_WARNING])).toEqual([
      IMEI_WARNING.message,
      DUPLICATE_WARNING.message,
    ]);
  });

  it('summarises by heading', () => {
    expect(deviceWarningSummary([IMEI_WARNING, DUPLICATE_WARNING], 'vi')).toBe(
      'IMEI có thể sai một chữ số · Serial đã có ở thiết bị khác',
    );
  });

  it('is empty-safe', () => {
    expect(deviceWarningMessages(null)).toEqual([]);
    expect(deviceWarningSummary(undefined, 'vi')).toBe('');
    expect(hasDeviceWarnings([])).toBe(false);
    expect(hasDeviceWarnings(null)).toBe(false);
    expect(hasDeviceWarnings([IMEI_WARNING])).toBe(true);
  });
});

describe('flash cookie codec', () => {
  it('round-trips a warning list, Vietnamese text included', () => {
    const encoded = encodeDeviceWarningsFlash({
      deviceId: 'dev_1',
      warnings: [IMEI_WARNING, DUPLICATE_WARNING],
    });
    expect(encoded).not.toBe('');
    expect(decodeDeviceWarningsFlash(encoded)).toEqual({
      deviceId: 'dev_1',
      warnings: [IMEI_WARNING, DUPLICATE_WARNING],
    });
  });

  it('encodes nothing when there is nothing to say, or no device to attach it to', () => {
    expect(encodeDeviceWarningsFlash(null)).toBe('');
    expect(encodeDeviceWarningsFlash(undefined)).toBe('');
    expect(encodeDeviceWarningsFlash({ deviceId: 'dev_1', warnings: [] })).toBe('');
    expect(encodeDeviceWarningsFlash({ deviceId: '  ', warnings: [IMEI_WARNING] })).toBe('');
  });

  it('skips an oversized payload instead of shipping a truncated cookie', () => {
    const fat = [
      {
        code: 'IMEI_LENGTH',
        field: 'serialNumber',
        message: 'ừ'.repeat(MAX_DEVICE_WARNING_MESSAGE_CHARS),
      },
    ];
    // 400 Vietnamese characters percent-encode to well over the 3KB cookie cap.
    expect(encodeDeviceWarningsFlash({ deviceId: 'dev_1', warnings: fat })).toBe('');
  });

  it('decodes garbage to null rather than throwing', () => {
    expect(decodeDeviceWarningsFlash(undefined)).toBeNull();
    expect(decodeDeviceWarningsFlash('')).toBeNull();
    expect(decodeDeviceWarningsFlash('   ')).toBeNull();
    expect(decodeDeviceWarningsFlash('not-json')).toBeNull();
    // Truncated percent-encoding.
    expect(decodeDeviceWarningsFlash('%E1%BB%AB%')).toBeNull();
    // Valid JSON of the wrong shape, and a payload with no device id.
    expect(decodeDeviceWarningsFlash(encodeURIComponent('{"a":1}'))).toBeNull();
    expect(
      decodeDeviceWarningsFlash(encodeURIComponent(JSON.stringify({ warnings: [IMEI_WARNING] }))),
    ).toBeNull();
  });

  it('only hands the warnings to the device they belong to', () => {
    const flash = { deviceId: 'dev_1', warnings: [IMEI_WARNING] };
    expect(warningsForDevice(flash, 'dev_1')).toEqual([IMEI_WARNING]);
    // A sibling device's page (e.g. reached by a prefetched link) gets nothing.
    expect(warningsForDevice(flash, 'dev_2')).toEqual([]);
    expect(warningsForDevice(flash, '')).toEqual([]);
    expect(warningsForDevice(null, 'dev_1')).toEqual([]);
    expect(warningsForDevice(undefined, 'dev_1')).toEqual([]);
  });
});
