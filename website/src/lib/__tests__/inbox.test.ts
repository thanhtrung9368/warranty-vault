import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '@/lib/i18n/catalog';
import {
  MAX_ATTACHMENTS_PER_DEVICE,
  attachmentFileError,
  deviceIsFull,
  inboxCount,
} from '@/lib/inbox';

// The pure half of the capture-first inbox. The Go endpoints do not exist while
// this change is written, so these tests pin the CONTRACT rather than a live
// response: how many rows a badge shows, which devices the picker flags as
// full, and — most importantly — that a 409 LIMIT_REACHED becomes copy that
// names both ways out instead of a generic failure.

// Same guard as the i18n tests: an English "translation" that is still the
// Vietnamese source is a silent fallback, not a translation.
const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

describe('inboxCount', () => {
  it('counts every unfiled attachment', () => {
    expect(inboxCount([])).toBe(0);
    expect(inboxCount([{ id: 'a' }])).toBe(1);
    expect(inboxCount([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(3);
  });

  it('treats a failed inbox read as an empty badge, never an exception', () => {
    // `(app)/layout.tsx` passes `null`-ish data when GET /v1/inbox fails; the
    // page must still render with a quiet badge instead of throwing on every
    // route in the group.
    expect(inboxCount(null)).toBe(0);
    expect(inboxCount(undefined)).toBe(0);
  });
});

describe('deviceIsFull', () => {
  it('matches the server cap of five attachments per device', () => {
    expect(MAX_ATTACHMENTS_PER_DEVICE).toBe(5);
  });

  it('flags exactly the devices that will answer 409 LIMIT_REACHED', () => {
    expect(deviceIsFull({ attachmentCount: 0 })).toBe(false);
    expect(deviceIsFull({ attachmentCount: 4 })).toBe(false);
    expect(deviceIsFull({ attachmentCount: 5 })).toBe(true);
    // Above the cap (legacy data, or a row that raced another client) is still
    // "full" — the picker must not imply a sixth slot exists.
    expect(deviceIsFull({ attachmentCount: 6 })).toBe(true);
  });

  it('treats a missing count as empty', () => {
    expect(deviceIsFull({})).toBe(false);
    expect(deviceIsFull({ attachmentCount: null })).toBe(false);
    expect(deviceIsFull(null)).toBe(false);
    expect(deviceIsFull(undefined)).toBe(false);
  });
});

describe('attachmentFileError', () => {
  it('maps the frozen 409 LIMIT_REACHED to copy naming both exits', () => {
    const failure = attachmentFileError({ status: 409, error: 'LIMIT_REACHED' });
    expect(failure.code).toBe('LIMIT_REACHED');
    expect(hasMessage(failure.key)).toBe(true);

    const english = translate('en', failure.key);
    expect(english).toContain('already has 5 files');
    expect(english).toContain('Pick another device');
    expect(english).toContain('delete this file');
    expect(VIETNAMESE_ONLY.test(english)).toBe(false);
  });

  it('accepts both the contract constant and the envelope casing', () => {
    // The frozen contract names the constant `LIMIT_REACHED`; the Go error
    // envelope lower-cases service codes on the wire. They are the same
    // refusal, and a casing mismatch must not turn "device is full" into a
    // generic error at the counter.
    expect(attachmentFileError({ status: 409, error: 'LIMIT_REACHED' }).code).toBe(
      'LIMIT_REACHED',
    );
    expect(attachmentFileError({ status: 409, error: 'limit_reached' }).code).toBe(
      'LIMIT_REACHED',
    );
  });

  it('does not claim a full device for a different 409 conflict', () => {
    // The CODE is pinned, not just the status: a future 409 for another reason
    // must not show "this device is full".
    const failure = attachmentFileError({ status: 409, error: 'SOMETHING_ELSE' });
    expect(failure.code).toBe('GENERIC');
    expect(translate('en', failure.key)).not.toContain('5 files');
  });

  it('separates a missing/not-owned row from a retryable failure', () => {
    expect(attachmentFileError({ status: 404, error: 'not_found' }).code).toBe('NOT_FOUND');
    expect(attachmentFileError({ status: 500, error: 'internal' }).code).toBe('GENERIC');
    expect(attachmentFileError({ status: 0, error: 'network_error' }).code).toBe('GENERIC');
  });

  it('registers every mapped sentence in the web dictionary', () => {
    const failures = [
      attachmentFileError({ status: 409, error: 'LIMIT_REACHED' }),
      attachmentFileError({ status: 404, error: 'not_found' }),
      attachmentFileError({ status: 500, error: 'internal' }),
    ];
    for (const failure of failures) {
      expect(hasMessage(failure.key)).toBe(true);
      expect(translate('en', failure.key).trim()).not.toBe('');
      expect(VIETNAMESE_ONLY.test(translate('en', failure.key))).toBe(false);
    }
  });
});
