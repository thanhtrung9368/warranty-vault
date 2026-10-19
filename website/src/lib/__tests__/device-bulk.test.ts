import { describe, expect, it } from 'vitest';
import type { BulkDeviceFailure, Device } from '@/lib/api/devices';
import {
  BULK_ACTIVE_DEVICE_LIMIT,
  BULK_DEVICE_MAX_ROWS,
  BULK_ROW_CAP_KEY,
  BULK_TOTAL_DEVICE_LIMIT,
  bulkDeviceInputFromDraft,
  bulkDeviceQuotaFromStats,
  bulkRowCapErrorKey,
  isBlankBulkDeviceDraft,
  isBulkLimitFailure,
  parseBulkDeviceRowsJson,
  parseBulkPrice,
  reconcileBulkRows,
} from '@/lib/device-bulk';
import { hasMessage } from '@/lib/i18n/catalog';

function device(id: string): Device {
  // Only `id` is read by the reconciliation (the UI links to it). A full Device
  // fixture would add a dozen irrelevant fields to every assertion.
  return { id, name: id } as unknown as Device;
}

function failure(index: number, fieldErrors?: Record<string, string[]>): BulkDeviceFailure {
  return {
    index,
    code: 'validation',
    message: 'Dữ liệu không hợp lệ',
    fieldErrors,
  };
}

function stats(total: number, sold: number) {
  return {
    devices: {
      total,
      byStatus: {
        ACTIVE: total - sold,
        EXPIRED: 0,
        SOLD: sold,
        BROKEN: 0,
        LOST: 0,
      },
      totalPurchasePrice: 0,
      totalWarrantyCost: 0,
    },
  };
}

describe('bulkDeviceInputFromDraft', () => {
  it('maps only the four minimum fields, trimmed, and converts the VND price', () => {
    const input = bulkDeviceInputFromDraft({
      name: '  Tủ lạnh Samsung  ',
      category: ' FRIDGE ',
      purchaseDate: '2026-03-15',
      purchasePrice: '15.000.000',
    });

    expect(input).toEqual({
      name: 'Tủ lạnh Samsung',
      category: 'FRIDGE',
      purchaseDate: '2026-03-15',
      purchasePrice: 15_000_000,
    });
    // Key-for-key: a bulk row must not quietly grow into the whole device form.
    expect(Object.keys(input).sort()).toEqual([
      'category',
      'name',
      'purchaseDate',
      'purchasePrice',
    ]);
  });

  it('treats a blank price as 0 — "chưa ghi giá", the server default', () => {
    const input = bulkDeviceInputFromDraft({
      name: 'Loa',
      category: 'SPEAKER',
      purchaseDate: '2026-01-02',
      purchasePrice: '   ',
    });
    expect(input.purchasePrice).toBe(0);
  });
});

describe('parseBulkPrice', () => {
  it('reads grouped đồng and decoration, and treats junk as blank', () => {
    expect(parseBulkPrice('')).toBe(0);
    expect(parseBulkPrice('15.000.000')).toBe(15_000_000);
    expect(parseBulkPrice('15,000,000 ₫')).toBe(15_000_000);
    expect(parseBulkPrice(' 12000000 ')).toBe(12_000_000);
    expect(parseBulkPrice('abc')).toBe(0);
  });
});

describe('isBlankBulkDeviceDraft', () => {
  it('only calls a row blank when every field is empty', () => {
    expect(
      isBlankBulkDeviceDraft({
        name: ' ',
        category: '',
        purchaseDate: '\t',
        purchasePrice: '',
      }),
    ).toBe(true);
    expect(
      isBlankBulkDeviceDraft({
        name: 'Máy giặt',
        category: '',
        purchaseDate: '',
        purchasePrice: '',
      }),
    ).toBe(false);
  });
});

describe('parseBulkDeviceRowsJson', () => {
  it('parses the hidden-field payload and drops any extra members', () => {
    const rows = parseBulkDeviceRowsJson(
      JSON.stringify([
        {
          id: 'row-1',
          name: 'Máy giặt',
          category: 'WASHING',
          purchaseDate: '2026-02-01',
          purchasePrice: '9000000',
          ignored: 'not part of the draft',
        },
      ]),
    );
    expect(rows).toEqual([
      {
        id: 'row-1',
        name: 'Máy giặt',
        category: 'WASHING',
        purchaseDate: '2026-02-01',
        purchasePrice: '9000000',
      },
    ]);
  });

  it('returns null for anything that is not an array of complete string rows', () => {
    expect(parseBulkDeviceRowsJson(null)).toBeNull();
    expect(parseBulkDeviceRowsJson('')).toBeNull();
    expect(parseBulkDeviceRowsJson('{not json')).toBeNull();
    expect(parseBulkDeviceRowsJson(JSON.stringify({ rows: [] }))).toBeNull();
    expect(parseBulkDeviceRowsJson(JSON.stringify([{ id: 'row-1' }]))).toBeNull();
    expect(
      parseBulkDeviceRowsJson(
        JSON.stringify([
          {
            id: '',
            name: 'Loa',
            category: 'SPEAKER',
            purchaseDate: '2026-02-01',
            purchasePrice: '1',
          },
        ]),
      ),
    ).toBeNull();
    expect(
      parseBulkDeviceRowsJson(
        JSON.stringify([
          {
            id: 'row-1',
            name: 'Loa',
            category: 'SPEAKER',
            purchaseDate: '2026-02-01',
            purchasePrice: 1,
          },
        ]),
      ),
    ).toBeNull();
  });
});

describe('bulkRowCapErrorKey', () => {
  it('allows exactly 50 rows and refuses 51', () => {
    expect(BULK_DEVICE_MAX_ROWS).toBe(50);
    expect(bulkRowCapErrorKey(0)).toBeNull();
    expect(bulkRowCapErrorKey(BULK_DEVICE_MAX_ROWS)).toBeNull();
    expect(bulkRowCapErrorKey(BULK_DEVICE_MAX_ROWS + 1)).toBe(BULK_ROW_CAP_KEY);
    expect(bulkRowCapErrorKey(100)).toBe(BULK_ROW_CAP_KEY);
  });

  it('keeps the cap message registered in both languages', () => {
    // The key is handed to `t()` dynamically, so the source-scanning coverage
    // test cannot see it; this is the assertion that keeps it translatable.
    expect(hasMessage(BULK_ROW_CAP_KEY)).toBe(true);
  });
});

describe('isBulkLimitFailure', () => {
  it('treats 409 as the whole-batch quota refusal, whatever the wire code casing', () => {
    expect(isBulkLimitFailure({ status: 409 })).toBe(true);
    expect(isBulkLimitFailure({ status: 400 })).toBe(false);
    expect(isBulkLimitFailure({ status: 422 })).toBe(false);
    expect(isBulkLimitFailure({ status: 429 })).toBe(false);
    expect(isBulkLimitFailure({ status: 0 })).toBe(false);
  });
});

describe('bulkDeviceQuotaFromStats', () => {
  it('counts unsold devices against the active ceiling and sold ones against the total', () => {
    const quota = bulkDeviceQuotaFromStats(stats(10, 2));
    expect(quota).toEqual({
      active: 8,
      total: 10,
      maxActive: BULK_ACTIVE_DEVICE_LIMIT,
      maxTotal: BULK_TOTAL_DEVICE_LIMIT,
      remainingActive: 42,
      remainingTotal: 490,
      remaining: 42,
    });
  });

  it('clamps an account already above the active ceiling to zero remaining', () => {
    const quota = bulkDeviceQuotaFromStats(stats(60, 5));
    expect(quota.active).toBe(55);
    expect(quota.remainingActive).toBe(0);
    expect(quota.remainingTotal).toBe(440);
    expect(quota.remaining).toBe(0);
  });

  it('reports the total ceiling when it is the tighter of the two', () => {
    // 495 rows total, 480 sold -> 15 active (35 active slots left), but only 5
    // storage slots left. The effective answer is 5.
    const quota = bulkDeviceQuotaFromStats(stats(495, 480));
    expect(quota.active).toBe(15);
    expect(quota.remainingActive).toBe(35);
    expect(quota.remainingTotal).toBe(5);
    expect(quota.remaining).toBe(5);
  });

  it('never returns a negative remainder', () => {
    const quota = bulkDeviceQuotaFromStats(stats(510, 20));
    expect(quota.remainingActive).toBe(0);
    expect(quota.remainingTotal).toBe(0);
    expect(quota.remaining).toBe(0);
  });

  it('starts a fresh account with both ceilings available', () => {
    const quota = bulkDeviceQuotaFromStats(stats(0, 0));
    expect(quota.remaining).toBe(BULK_DEVICE_MAX_ROWS);
  });
});

describe('reconcileBulkRows', () => {
  const rows = ['A', 'B', 'C', 'D', 'E'];
  const failed = [failure(1, { purchaseDate: ['Ngày mua không hợp lệ'] }), failure(3)];

  it('maps created devices back by position, skipping failed indices', () => {
    const created = [device('dev-a'), device('dev-c'), device('dev-e')];
    const result = reconcileBulkRows(rows, { created, failed });

    expect(result).toHaveLength(5);
    expect(result.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.map((entry) => entry.row)).toEqual(rows);
    expect(result.map((entry) => entry.outcome.status)).toEqual([
      'created',
      'failed',
      'created',
      'failed',
      'created',
    ]);
    expect(result[0].outcome).toEqual({
      status: 'created',
      device: created[0],
    });
    expect(result[1].outcome).toEqual({ status: 'failed', failure: failed[0] });
    expect(result[2].outcome).toEqual({
      status: 'created',
      device: created[1],
    });
    expect(result[4].outcome).toEqual({
      status: 'created',
      device: created[2],
    });
  });

  it('keeps each failure on the row the server indexed, including its field errors', () => {
    const result = reconcileBulkRows(rows, {
      created: [],
      failed: [failure(2, { category: ['Loại thiết bị không hợp lệ'] })],
    });
    const failedEntry = result.find((entry) => entry.outcome.status === 'failed');
    expect(failedEntry?.index).toBe(2);
    expect(failedEntry?.row).toBe('C');
    expect(failedEntry?.outcome).toMatchObject({
      status: 'failed',
      failure: { fieldErrors: { category: ['Loại thiết bị không hợp lệ'] } },
    });
  });

  it('maps an all-created response in request order', () => {
    const created = rows.map((_, index) => device(`dev-${index}`));
    const result = reconcileBulkRows(rows, { created, failed: [] });
    expect(result.map((entry) => entry.outcome.status)).toEqual([
      'created',
      'created',
      'created',
      'created',
      'created',
    ]);
    expect(result.map((entry) => entry.outcome.status === 'created' && entry.outcome.device.id)).toEqual(
      ['dev-0', 'dev-1', 'dev-2', 'dev-3', 'dev-4'],
    );
  });

  it('maps an all-failed response without inventing a created device', () => {
    const result = reconcileBulkRows(rows, {
      created: [],
      failed: rows.map((_, index) => failure(index)),
    });
    expect(result.every((entry) => entry.outcome.status === 'failed')).toBe(true);
  });

  it('marks a row unresolved rather than guessing when the response is incomplete', () => {
    const result = reconcileBulkRows(['A', 'B'], {
      created: [device('dev-a')],
      failed: [],
    });
    expect(result[0].outcome.status).toBe('created');
    expect(result[1].outcome).toEqual({ status: 'unresolved' });
  });

  it('ignores a failure index that is outside the submitted array', () => {
    const result = reconcileBulkRows(['A', 'B'], {
      created: [device('dev-a'), device('dev-b')],
      failed: [failure(7), failure(-1)],
    });
    expect(result.map((entry) => entry.outcome.status)).toEqual(['created', 'created']);
  });
});
