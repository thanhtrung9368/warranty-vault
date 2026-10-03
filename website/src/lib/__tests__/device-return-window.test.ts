import { describe, expect, it } from 'vitest';
import {
  receivedAtInputValue,
  returnDeadlineNote,
  returnWindowDaysInputValue,
  returnWindowFieldsFromFormData,
  type ReturnWindowFields,
  type ReturnWindowSource,
} from '@/lib/device-return-window';

// The return window (migration 0010): `returnWindowDays` + `receivedAt` on
// `Device`, `returnDeadline` derived server-side. `PATCH /v1/devices/{id}` is a
// full replacement, so these helpers exist to carry an existing value through an
// ordinary edit from the web — where no input for the window is rendered.
//
// The round-trip test below wires the two halves together exactly as the form
// and the server action do:
//
//   device (GET)  --returnWindowDaysInputValue-->  hidden input value
//                 --receivedAtInputValue-------->   hidden input value
//                 --FormData (on submit)--------->  returnWindowFieldsFromFormData
//                                                    --PATCH body----------->
//
// A value that survives that chain is a value the edit cannot erase.

/** Build the FormData the device form submits: the two always-mounted hidden inputs. */
function submittedForm(device: ReturnWindowSource): FormData {
  const fd = new FormData();
  fd.set('returnWindowDays', returnWindowDaysInputValue(device.returnWindowDays));
  fd.set('receivedAt', receivedAtInputValue(device.receivedAt));
  return fd;
}

function roundTrip(device: ReturnWindowSource): ReturnWindowFields {
  return returnWindowFieldsFromFormData(submittedForm(device));
}

describe('returnWindowDaysInputValue', () => {
  it('is blank for an unrecorded window', () => {
    expect(returnWindowDaysInputValue(null)).toBe('');
    expect(returnWindowDaysInputValue(undefined)).toBe('');
  });

  it('keeps 0 as "no exchange allowed" instead of blanking it', () => {
    // `0` and `null` are different answers (openapi Device.returnWindowDays):
    // collapsing 0 into null would rewrite the user's own policy record.
    expect(returnWindowDaysInputValue(0)).toBe('0');
    expect(roundTrip({ returnWindowDays: 0, receivedAt: null }).returnWindowDays).toBe(0);
  });

  it('keeps a positive day count', () => {
    expect(returnWindowDaysInputValue(30)).toBe('30');
    expect(returnWindowDaysInputValue(3650)).toBe('3650');
  });

  it('blanks a non-finite value rather than sending NaN', () => {
    expect(returnWindowDaysInputValue(Number.NaN)).toBe('');
    expect(returnWindowDaysInputValue(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('receivedAtInputValue', () => {
  it('is blank when nothing was recorded', () => {
    expect(receivedAtInputValue(null)).toBe('');
    expect(receivedAtInputValue(undefined)).toBe('');
    expect(receivedAtInputValue('   ')).toBe('');
  });

  it('sends a whole-second wire value back byte-for-byte', () => {
    // The shape `pgtype.Timestamp` emits for every value the app wrote itself,
    // and one of the layouts `services.parseDate` accepts.
    const wire = '2026-03-01T00:00:00';
    expect(receivedAtInputValue(wire)).toBe(wire);
    expect(roundTrip({ returnWindowDays: 15, receivedAt: wire }).receivedAt).toBe(wire);
  });

  it('re-anchors a sub-second wire value to its own calendar day', () => {
    // `2026-03-01T10:30:00.5` is Z-less but fractional, the single shape
    // parseDate rejects — sending it verbatim would 400 the whole save. The
    // string is Z-less UTC, so the day is still exactly what the server stored.
    expect(receivedAtInputValue('2026-03-01T10:30:00.5')).toBe('2026-03-01');
    expect(receivedAtInputValue('2026-03-01T10:30:00.123456')).toBe('2026-03-01');
  });

  it('reduces an offset timestamp to its stored UTC day', () => {
    // parseDate does `.UTC()`, so "2026-03-01T02:00:00+07:00" is stored as
    // 2026-02-28T19:00 — and the wire value says so.
    expect(receivedAtInputValue('2026-02-28T19:00:00Z')).toBe('2026-02-28');
  });

  it('yields blank for something unreadable, never an invented date', () => {
    expect(receivedAtInputValue('không phải ngày')).toBe('');
    expect(receivedAtInputValue('01/03/2026')).toBe('');
  });
});

describe('round-trip through the form', () => {
  it('preserves a recorded window exactly', () => {
    const device = { returnWindowDays: 30, receivedAt: '2026-03-01T00:00:00' };
    expect(roundTrip(device)).toEqual({
      returnWindowDays: 30,
      receivedAt: '2026-03-01T00:00:00',
    });
  });

  it('preserves the "chưa biết" and "không cho đổi trả" answers separately', () => {
    expect(roundTrip({ returnWindowDays: null, receivedAt: null })).toEqual({
      returnWindowDays: null,
      receivedAt: null,
    });
    expect(roundTrip({ returnWindowDays: 0, receivedAt: null })).toEqual({
      returnWindowDays: 0,
      receivedAt: null,
    });
  });

  it('preserves the day count when only the window length was recorded', () => {
    expect(roundTrip({ returnWindowDays: 365 })).toEqual({
      returnWindowDays: 365,
      receivedAt: null,
    });
  });

  it('preserves a received date recorded without a window length', () => {
    expect(roundTrip({ returnWindowDays: null, receivedAt: '2026-02-20T00:00:00' })).toEqual({
      returnWindowDays: null,
      receivedAt: '2026-02-20T00:00:00',
    });
  });
});

describe('returnWindowFieldsFromFormData', () => {
  it('sends both keys as null when the form has no window (create flow)', () => {
    // Explicit `null` is the server's clear signal; a missing key would be
    // indistinguishable from "this client forgot to send it".
    expect(returnWindowFieldsFromFormData(new FormData())).toEqual({
      returnWindowDays: null,
      receivedAt: null,
    });
  });

  it('documents the trap: a submission without the hidden inputs clears the window', () => {
    // This is the failure mode the always-mounted hidden inputs exist to avoid.
    const dropped = new FormData();
    dropped.set('name', 'Máy giặt LG');
    expect(returnWindowFieldsFromFormData(dropped)).toEqual({
      returnWindowDays: null,
      receivedAt: null,
    });
  });

  it('treats blank entries as null but keeps an explicit 0', () => {
    const fd = new FormData();
    fd.set('returnWindowDays', '');
    fd.set('receivedAt', '');
    expect(returnWindowFieldsFromFormData(fd)).toEqual({
      returnWindowDays: null,
      receivedAt: null,
    });

    const zero = new FormData();
    zero.set('returnWindowDays', '0');
    zero.set('receivedAt', '2026-03-01');
    expect(returnWindowFieldsFromFormData(zero)).toEqual({
      returnWindowDays: 0,
      receivedAt: '2026-03-01',
    });
  });

  it('blanks an unparseable day count', () => {
    const fd = new FormData();
    fd.set('returnWindowDays', 'ba mươi');
    expect(returnWindowFieldsFromFormData(fd).returnWindowDays).toBeNull();
  });
});

describe('returnDeadlineNote', () => {
  const now = new Date('2026-04-10T09:00:00');

  it('reads the derived deadline in Vietnamese at day resolution', () => {
    expect(returnDeadlineNote('2026-04-13T00:00:00', now)).toBe('còn 3 ngày');
    // 0 = today is the last day (same semantics as ReturnWindow.daysLeft).
    expect(returnDeadlineNote('2026-04-10T00:00:00', now)).toBe('hôm nay là ngày cuối');
    expect(returnDeadlineNote('2026-04-01T00:00:00', now)).toBe('đã qua 9 ngày');
  });
});
