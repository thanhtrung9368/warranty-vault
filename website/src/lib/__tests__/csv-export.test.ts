import { describe, it, expect } from 'vitest';
import type { DeviceListItem } from '@/lib/api/devices';
import type { Subscription } from '@/lib/api/subscriptions';
import type { WishlistItem } from '@/lib/api/wishlist';
import {
  CSV_DATASET_META,
  CSV_DATASETS,
  DEVICE_CSV_HEADER,
  SUBSCRIPTION_CSV_HEADER,
  WISHLIST_CSV_HEADER,
  csvFileName,
  csvTableToString,
  deviceCsvRows,
  devicesCsvTable,
  isCsvDataset,
  subscriptionCsvRows,
  subscriptionsCsvTable,
  wishlistCsvRows,
  wishlistCsvTable,
} from '@/lib/csv-export';
import { CSV_BOM } from '@/lib/csv';

// `lib/csv-export.ts` maps the wire rows the web already fetches onto CSV
// columns. These tests pin the Vietnamese labels, the plain-number money
// columns, the dd/MM/yyyy dates, the null-vs-empty behaviour and the
// header/row width invariant.

function device(over: Partial<DeviceListItem> = {}): DeviceListItem {
  return {
    id: 'dev-1',
    userId: 'user-1',
    name: 'Máy giặt LG',
    category: 'WASHING',
    brand: 'LG',
    model: 'FV1410S4M',
    serialNumber: 'SN-0001',
    purchaseDate: '2024-03-08T00:00:00Z',
    purchasePrice: 15000000,
    purchasePlace: 'Điện Máy Xanh',
    status: 'ACTIVE',
    notes: null,
    // Resale pair — absent on this fixture on purpose: the CSV export does not
    // carry sold columns, so these stay at the "not sold" defaults.
    soldAt: null,
    soldPrice: null,
    createdAt: '2024-03-08T10:00:00Z',
    updatedAt: '2024-03-08T10:00:00Z',
    attachmentCount: 0,
    effectiveWarrantyEnd: '2026-03-08T00:00:00Z',
    ...over,
  };
}

function subscription(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    name: 'Netflix',
    category: 'ELECTRONICS',
    brand: 'Netflix',
    plan: 'Standard',
    billingCycle: 'MONTHLY',
    intervalDays: null,
    price: 260000,
    currency: 'VND',
    startedAt: '2025-01-01T00:00:00Z',
    renewalDate: '2025-02-01T00:00:00Z',
    autoRenew: true,
    status: 'ACTIVE',
    accountEmail: 'me@example.com',
    paymentMethod: 'Visa •••• 1234',
    manageUrl: null,
    cancelUrl: null,
    notes: null,
    ...over,
  };
}

function wishlistItem(over: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 'wish-1',
    name: 'Tai nghe Sony WH-1000XM5',
    category: 'HEADPHONE',
    brand: 'Sony',
    initialPrice: 8000000,
    currentPrice: 6500000,
    buyUrl: 'https://example.com/sony',
    imageUrl: null,
    targetDate: '2026-06-30T00:00:00Z',
    priority: 'WANT',
    status: 'WATCHING',
    notes: null,
    reminderIntervalDays: null,
    lastNotifiedAt: null,
    purchasedDeviceId: null,
    ...over,
  };
}

describe('deviceCsvRows', () => {
  it('maps a normal device onto the documented columns', () => {
    const [row] = deviceCsvRows([device()]);
    expect(row).toEqual([
      'Máy giặt LG',
      'Máy giặt / Sấy', // categoryLabel('WASHING')
      'LG',
      'FV1410S4M',
      'SN-0001',
      '08/03/2024', // dd/MM/yyyy, not the raw ISO string
      '15000000', // bare number, no ₫ / separators
      'Điện Máy Xanh',
      'Đang dùng', // STATUS_LABELS.ACTIVE
      '08/03/2026', // effectiveWarrantyEnd
      '', // notes === null → empty cell, not "null"
    ]);
  });

  it('keeps the header width when every optional field is null', () => {
    const [row] = deviceCsvRows([
      device({
        name: 'Chuột không tên',
        category: 'MOUSE',
        brand: null,
        model: null,
        serialNumber: null,
        purchasePrice: 0,
        purchasePlace: null,
        status: 'EXPIRED',
        notes: null,
        effectiveWarrantyEnd: null, // no warranty rows at all
      }),
    ]);
    expect(row.slice(2, 5)).toEqual(['', '', '']);
    expect(row[6]).toBe('0'); // 0 đồng is not an empty cell
    expect(row[7]).toBe('');
    expect(row[9]).toBe(''); // no warranty → empty, never "Invalid Date"
  });

  it('passes the raw category / status code through when it is unknown', () => {
    const [row] = deviceCsvRows([
      device({ category: 'SOMETHING_NEW', status: 'MYSTERY' }),
    ]);
    expect(row[1]).toBe('SOMETHING_NEW');
    expect(row[8]).toBe('MYSTERY');
  });
});

describe('devicesCsvTable', () => {
  it('escapes a Vietnamese name that contains the delimiter, a quote and a newline', () => {
    const csv = csvTableToString(
      devicesCsvTable([
        device({
          name: 'Máy "xịn"; 2 chiếc\n(mua 2024)',
          brand: null,
          serialNumber: null,
          effectiveWarrantyEnd: null,
          purchasePrice: 0,
        }),
      ]),
      ';',
    );

    const lines = csv.replace(CSV_BOM, '').split('\r\n');
    expect(lines[0].split(';')).toEqual([
      'Tên thiết bị',
      'Danh mục',
      'Hãng',
      'Model',
      'Số seri',
      'Ngày mua',
      'Giá mua',
      'Nơi mua',
      'Trạng thái',
      'Hết bảo hành',
      'Ghi chú',
    ]);
    expect(lines[1]).toBe(
      '"Máy ""xịn""; 2 chiếc\n(mua 2024)";Máy giặt / Sấy;;FV1410S4M;;08/03/2024;0;Điện Máy Xanh;Đang dùng;;',
    );
    // The embedded "\n" did not create a record: header + 1 data row + the
    // empty tail after the trailing CRLF. A bare (unquoted) newline would have
    // pushed this to 4.
    expect(lines).toHaveLength(3);
  });

  it('starts the file with a BOM and ends with a trailing CRLF', () => {
    const csv = csvTableToString(devicesCsvTable([device()]), ',');
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect([...Buffer.from(csv, 'utf8').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits only the header when there are no devices', () => {
    const csv = csvTableToString(devicesCsvTable([]), ';');
    expect(csv).toBe(`${CSV_BOM}${DEVICE_CSV_HEADER.join(';')}\r\n`);
  });
});

describe('subscriptionCsvRows', () => {
  it('maps labels, money and the monthly equivalent', () => {
    const [row] = subscriptionCsvRows([
      subscription({ billingCycle: 'YEARLY', price: 2400000 }),
    ]);
    expect(row).toEqual([
      'Netflix',
      'Điện tử khác', // categoryLabel('ELECTRONICS')
      'Netflix',
      'Standard',
      'Hàng năm', // BILLING_CYCLE_LABELS.YEARLY
      '2400000',
      'VND',
      '200000', // 2.400.000 / 12
      '01/01/2025',
      '01/02/2025',
      'Có',
      'Đang hoạt động',
      'me@example.com',
      'Visa •••• 1234',
      '',
    ]);
  });

  it('keeps nulls empty and lifetime at 0 per month', () => {
    const [row] = subscriptionCsvRows([
      subscription({
        category: null,
        brand: null,
        plan: null,
        billingCycle: 'LIFETIME',
        price: 0,
        autoRenew: false,
        accountEmail: null,
        paymentMethod: null,
        notes: null,
      }),
    ]);
    expect(row.slice(1, 4)).toEqual(['', '', '']);
    expect(row[5]).toBe('0');
    expect(row[7]).toBe('0'); // LIFETIME → 0, matching the dashboard maths
    expect(row[10]).toBe('Không');
    expect(row[12]).toBe('');
    expect(row[13]).toBe('');
  });
});

describe('wishlistCsvRows', () => {
  it('maps priority / status labels and nullable prices', () => {
    const [row] = wishlistCsvRows([wishlistItem()]);
    expect(row).toEqual([
      'Tai nghe Sony WH-1000XM5',
      'Tai nghe',
      'Sony',
      'Muốn', // WISHLIST_PRIORITY_LABELS.WANT
      'Đang theo dõi', // WISHLIST_STATUS_LABELS.WATCHING
      '8000000',
      '6500000',
      '30/06/2026',
      'https://example.com/sony',
      '',
    ]);
  });

  it('leaves an unpriced, undated item blank', () => {
    const [row] = wishlistCsvRows([
      wishlistItem({
        category: null,
        brand: null,
        initialPrice: null,
        currentPrice: null,
        targetDate: null,
        buyUrl: null,
        priority: 'MUST',
        status: 'PURCHASED',
        notes: 'mua khi giảm giá; dưới 5tr',
      }),
    ]);
    expect(row.slice(1, 3)).toEqual(['', '']);
    expect(row.slice(5, 9)).toEqual(['', '', '', '']);
    expect(row[3]).toBe('Phải mua');
    expect(row[4]).toBe('Đã mua');
    expect(row[9]).toBe('mua khi giảm giá; dưới 5tr');
  });
});

describe('table integrity', () => {
  it('every built row matches its header width', () => {
    const rowsByHeader: [readonly unknown[], number][] = [
      [deviceCsvRows([device(), device({ brand: null, notes: null })]), DEVICE_CSV_HEADER.length],
      [
        subscriptionCsvRows([subscription(), subscription({ category: null })]),
        SUBSCRIPTION_CSV_HEADER.length,
      ],
      [
        wishlistCsvRows([wishlistItem(), wishlistItem({ currentPrice: null })]),
        WISHLIST_CSV_HEADER.length,
      ],
    ];
    for (const [rows, width] of rowsByHeader) {
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toHaveLength(width);
    }
  });

  it('all three tables start with a BOM and end with a row', () => {
    const outputs = [
      csvTableToString(devicesCsvTable([]), ';'),
      csvTableToString(subscriptionsCsvTable([]), ';'),
      csvTableToString(wishlistCsvTable([]), ';'),
    ];
    for (const out of outputs) {
      expect(out.startsWith(CSV_BOM)).toBe(true);
      expect(out.endsWith('\r\n')).toBe(true);
      // BOM + exactly one (header) record.
      expect(out.replace(CSV_BOM, '').split('\r\n')).toHaveLength(2);
    }
  });
});

describe('dataset registry + file name', () => {
  it('lists the three exported datasets with Vietnamese labels', () => {
    expect(CSV_DATASETS).toEqual(['devices', 'subscriptions', 'wishlist']);
    expect(CSV_DATASET_META.devices.label).toBe('Thiết bị');
    expect(CSV_DATASET_META.subscriptions.label).toBe('Gói đăng ký');
    expect(CSV_DATASET_META.wishlist.label).toBe('Wishlist');
    for (const id of CSV_DATASETS) {
      expect(CSV_DATASET_META[id].description.length).toBeGreaterThan(10);
      expect(CSV_DATASET_META[id].fileSlug).toMatch(/^[a-z-]+$/);
    }
  });

  it('guards the dataset id coming from the client', () => {
    expect(isCsvDataset('devices')).toBe(true);
    expect(isCsvDataset('users')).toBe(false);
    expect(isCsvDataset(null)).toBe(false);
    expect(isCsvDataset(7)).toBe(false);
  });

  it('builds an ASCII, timestamped .csv name', () => {
    const now = new Date(2025, 0, 15, 10, 30);
    expect(csvFileName('devices', now)).toBe('warrantyvault-thiet-bi-20250115-1030.csv');
    expect(csvFileName('subscriptions', now)).toBe(
      'warrantyvault-goi-dang-ky-20250115-1030.csv',
    );
    expect(csvFileName('wishlist', now)).toBe('warrantyvault-wishlist-20250115-1030.csv');
  });
});
