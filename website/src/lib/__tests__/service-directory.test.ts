import { describe, expect, it } from 'vitest';
import {
  DIRECTORY_ADDRESS_NONE,
  DIRECTORY_NO_BRAND_INPUT_TITLE,
  DIRECTORY_NO_CENTRES,
  DIRECTORY_NO_ENTRY_DETAIL,
  DIRECTORY_NO_ENTRY_TITLE,
  DIRECTORY_NO_VERIFIED_LINK,
  DIRECTORY_PHONE_HONESTY,
  DIRECTORY_PHONE_NONE_HINT,
  DIRECTORY_PHONE_NONE_LABEL,
  DIRECTORY_PHONE_UNVERIFIED_LABEL,
  DIRECTORY_PHONE_USER_HINT,
  DIRECTORY_PHONE_USER_LABEL,
  DIRECTORY_PROVIDER_UNMATCHED,
  brandEntryState,
  centreProviderState,
  centreStatus,
  directoryContactSummary,
  directorySummaryLine,
  normalizePhoneSource,
  normalizeServiceDirectory,
  phoneDisclosure,
  safeExternalUrl,
  warrantyTypeLabel,
  type WarrantyCentre,
} from '@/lib/service-directory';

const NOW = new Date('2026-06-15T12:00:00Z');

// A row chosen at each interesting corner of the honesty contract.
function centre(overrides: Partial<WarrantyCentre> = {}): WarrantyCentre {
  return {
    warrantyId: 'w1',
    warrantyType: 'STANDARD',
    endDate: '2027-06-15T12:00:00Z',
    isActive: true,
    providerInput: 'Samsung',
    provider: {
      id: 'samsung',
      name: 'Samsung',
      phone: null,
      address: null,
      websiteUrl: null,
      notes: null,
    },
    address: '12 Nguyễn Huệ, Q.1',
    phone: '0901234567',
    phoneSource: 'user',
    ...overrides,
  };
}

const rawCentre = {
  warrantyId: 'w1',
  warrantyType: 'STANDARD',
  endDate: '2027-06-15T12:00:00Z',
  isActive: true,
  providerInput: 'Samsung',
  provider: { id: 'samsung', name: 'Samsung' },
  address: null,
  phone: '0901234567',
  phoneSource: 'user',
};

describe('normalizePhoneSource', () => {
  it('keeps the two documented values', () => {
    expect(normalizePhoneSource('user', '0901234567')).toBe('user');
    expect(normalizePhoneSource('none', null)).toBe('none');
  });

  it('never promotes an unknown source to "user" when a number is present', () => {
    expect(normalizePhoneSource(undefined, '0901234567')).toBe('unknown');
    expect(normalizePhoneSource('catalog', '0901234567')).toBe('unknown');
    expect(normalizePhoneSource(42, '0901234567')).toBe('unknown');
  });

  it('treats a missing source with no number as none', () => {
    expect(normalizePhoneSource(undefined, null)).toBe('none');
    expect(normalizePhoneSource('catalog', null)).toBe('none');
    // Contradictory payload: the app keeps saying "there is no number".
    expect(normalizePhoneSource('none', null)).toBe('none');
  });
});

describe('safeExternalUrl', () => {
  it('keeps http(s) links exactly as the catalog wrote them', () => {
    expect(safeExternalUrl('https://support.apple.com/vi-vn')).toBe(
      'https://support.apple.com/vi-vn',
    );
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
  });

  it('refuses anything that is not http(s)', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(safeExternalUrl('mailto:a@b.c')).toBeNull();
    expect(safeExternalUrl('/vi-vn')).toBeNull();
    expect(safeExternalUrl('khong-phai-url')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });

  it('drops an unsafe catalog link during normalisation, leaving the honest null', () => {
    const dir = normalizeServiceDirectory({
      deviceId: 'd1',
      brand: {
        brandId: 'x',
        name: 'X',
        serviceLocatorUrl: 'javascript:alert(1)',
        supportUrl: 'https://x.example/support',
      },
    });
    expect(dir!.brand!.serviceLocatorUrl).toBeNull();
    expect(dir!.brand!.supportUrl).toBe('https://x.example/support');
  });
});

describe('normalizeServiceDirectory', () => {
  it('rejects payloads that are not a directory', () => {
    expect(normalizeServiceDirectory(null)).toBeNull();
    expect(normalizeServiceDirectory(undefined)).toBeNull();
    expect(normalizeServiceDirectory('nope')).toBeNull();
    expect(normalizeServiceDirectory([])).toBeNull();
    // No deviceId → we cannot even say which device this is about.
    expect(normalizeServiceDirectory({ deviceName: 'X' })).toBeNull();
  });

  it('normalises the full bundle', () => {
    const dir = normalizeServiceDirectory({
      deviceId: 'd1',
      deviceName: 'iPhone 15',
      category: 'PHONE',
      brandInput: ' Apple ',
      brand: {
        brandId: 'apple',
        name: 'Apple',
        serviceLocatorUrl: 'https://support.apple.com/vi-vn',
        supportUrl: null,
        notes: 'Trang tra cứu TTBH uỷ quyền.',
      },
      centres: [rawCentre],
      disclaimer: '  App không lưu sẵn hotline.  ',
    });
    expect(dir).not.toBeNull();
    expect(dir!.brandInput).toBe('Apple');
    expect(dir!.brand?.brandId).toBe('apple');
    expect(dir!.centres).toHaveLength(1);
    expect(dir!.centres[0].provider?.name).toBe('Samsung');
    expect(dir!.disclaimer).toBe('App không lưu sẵn hotline.');
  });

  it('never lets a null brand become an invented row', () => {
    const dir = normalizeServiceDirectory({
      deviceId: 'd1',
      brandInput: 'Hãng lạ',
      brand: null,
      centres: [],
    });
    expect(dir!.brand).toBeNull();
  });

  it('drops a brand object that carries no id/name instead of rendering half a row', () => {
    const dir = normalizeServiceDirectory({ deviceId: 'd1', brand: { notes: 'x' } });
    expect(dir!.brand).toBeNull();
  });

  it('always yields an array of centres, dropping unusable rows', () => {
    expect(normalizeServiceDirectory({ deviceId: 'd1' })!.centres).toEqual([]);
    expect(normalizeServiceDirectory({ deviceId: 'd1', centres: 'x' })!.centres).toEqual([]);
    const dir = normalizeServiceDirectory({
      deviceId: 'd1',
      centres: [rawCentre, null, 'x', { warrantyType: 'STANDARD' }, { warrantyId: 'w2' }],
    });
    expect(dir!.centres.map((c) => c.warrantyId)).toEqual(['w1', 'w2']);
  });

  it('marks a phone with no usable source as unverified, not as the user’s', () => {
    const dir = normalizeServiceDirectory({ deviceId: 'd1', centres: [rawCentre] });
    // source given as 'user' → kept
    expect(dir!.centres[0].phoneSource).toBe('user');
    const noSource = normalizeServiceDirectory({
      deviceId: 'd1',
      centres: [{ ...rawCentre, phoneSource: undefined }],
    });
    expect(noSource!.centres[0].phoneSource).toBe('unknown');
  });

  it('turns a non-string disclaimer into an empty string (the card then omits it)', () => {
    expect(normalizeServiceDirectory({ deviceId: 'd1', disclaimer: null })!.disclaimer).toBe('');
  });
});

describe('brandEntryState', () => {
  it('asks for the brand when the device has none', () => {
    const state = brandEntryState({ brand: null, brandInput: null });
    expect(state.kind).toBe('no-input');
    expect(state.title).toBe(DIRECTORY_NO_BRAND_INPUT_TITLE);
  });

  it('explains a null brand instead of rendering an empty box', () => {
    const state = brandEntryState({ brand: null, brandInput: 'Hãng lạ' });
    expect(state.kind).toBe('no-entry');
    if (state.kind !== 'no-entry') throw new Error('unreachable');
    expect(state.brandInput).toBe('Hãng lạ');
    expect(state.title).toBe(DIRECTORY_NO_ENTRY_TITLE);
    expect(state.detail).toContain('không đoán');
  });

  it('surfaces the brand row with its verified links', () => {
    const state = brandEntryState({
      brandInput: 'Apple',
      brand: {
        brandId: 'apple',
        name: 'Apple',
        serviceLocatorUrl: 'https://support.apple.com/vi-vn',
        supportUrl: null,
        notes: null,
      },
    });
    expect(state.kind).toBe('entry');
    if (state.kind !== 'entry') throw new Error('unreachable');
    expect(state.hasVerifiedLink).toBe(true);
    expect(state.serviceLocatorUrl).toBe('https://support.apple.com/vi-vn');
  });

  it('says so when the matched brand has no verified link at all', () => {
    const state = brandEntryState({
      brandInput: 'Apple',
      brand: { brandId: 'apple', name: 'Apple', serviceLocatorUrl: null, supportUrl: null, notes: 'x' },
    });
    if (state.kind !== 'entry') throw new Error('unreachable');
    expect(state.hasVerifiedLink).toBe(false);
    expect(state.detail).toBe(DIRECTORY_NO_VERIFIED_LINK);
  });
});

describe('phoneDisclosure', () => {
  it('renders a user-typed number as exactly that', () => {
    const d = phoneDisclosure({ phone: '0901234567', phoneSource: 'user' });
    expect(d.kind).toBe('user');
    expect(d.phone).toBe('0901234567');
    expect(d.label).toBe(DIRECTORY_PHONE_USER_LABEL);
    expect(d.hint).toBe(DIRECTORY_PHONE_USER_HINT);
    expect(d.hint).toContain('không kiểm chứng');
  });

  it('renders phoneSource: none as "there is nothing", never as a hotline', () => {
    const d = phoneDisclosure({ phone: null, phoneSource: 'none' });
    expect(d.kind).toBe('none');
    expect(d.phone).toBeNull();
    expect(d.label).toBe(DIRECTORY_PHONE_NONE_LABEL);
    expect(d.hint).toBe(DIRECTORY_PHONE_NONE_HINT);
    expect(d.hint).toContain('không có số nào');
  });

  it('treats a blank phone as none', () => {
    expect(phoneDisclosure({ phone: '   ', phoneSource: 'user' }).kind).toBe('none');
    expect(phoneDisclosure({ phone: '', phoneSource: 'none' }).kind).toBe('none');
  });

  it('flags a number whose source is unknown rather than vouching for it', () => {
    const d = phoneDisclosure({ phone: '0901234567', phoneSource: 'unknown' });
    expect(d.kind).toBe('unverified');
    expect(d.label).toBe(DIRECTORY_PHONE_UNVERIFIED_LABEL);
    expect(d.tone).toBe('amber');
  });

  it('flags a self-contradictory payload (number + source none) too', () => {
    expect(phoneDisclosure({ phone: '0901234567', phoneSource: 'none' }).kind).toBe('unverified');
  });

  it('states the app is never the source of a phone number', () => {
    expect(DIRECTORY_PHONE_HONESTY).toContain('không phải nguồn của số điện thoại nào');
    expect(DIRECTORY_PHONE_HONESTY).toContain('không phải hotline');
  });
});

describe('centreStatus', () => {
  it('trusts the server-computed isActive', () => {
    expect(centreStatus({ isActive: true, endDate: '2020-01-01T00:00:00Z' }, NOW)).toEqual({
      kind: 'active',
      label: 'Còn hạn',
    });
    expect(centreStatus({ isActive: false, endDate: '2099-01-01T00:00:00Z' }, NOW)).toEqual({
      kind: 'expired',
      label: 'Đã hết hạn',
    });
  });

  it('gives "no end date" its own answer, not a default of expired', () => {
    expect(centreStatus({ isActive: false, endDate: null }, NOW)).toEqual({
      kind: 'undated',
      label: 'Chưa ghi hạn',
    });
    expect(centreStatus({ isActive: false, endDate: 'not-a-date' }, NOW).kind).toBe('undated');
  });

  it('derives the state from the end date when the flag is absent', () => {
    const opts = { isActive: undefined as unknown as boolean };
    expect(centreStatus({ ...opts, endDate: '2027-01-01T00:00:00Z' }, NOW).kind).toBe('active');
    expect(centreStatus({ ...opts, endDate: '2026-01-01T00:00:00Z' }, NOW).kind).toBe('expired');
  });
});

describe('centreProviderState', () => {
  it('shows the matched catalog name and keeps the typed text visible', () => {
    const state = centreProviderState({
      provider: centre().provider,
      providerInput: 'Samsung VN',
    });
    expect(state.kind).toBe('matched');
    expect(state.name).toBe('Samsung');
    expect(state.input).toBe('Samsung VN');
  });

  it('shows the user’s own words when nothing matched, and says it did not guess', () => {
    const state = centreProviderState({ provider: null, providerInput: 'TTBH FPT' });
    expect(state.kind).toBe('unmatched');
    expect(state.name).toBeNull();
    expect(state.input).toBe('TTBH FPT');
    expect(state.note).toBe(DIRECTORY_PROVIDER_UNMATCHED);
  });

  it('distinguishes "nothing typed" from "typed but unmatched"', () => {
    const state = centreProviderState({ provider: null, providerInput: null });
    expect(state.kind).toBe('no-input');
    expect(state.input).toBeNull();
  });
});

describe('directoryContactSummary / directorySummaryLine', () => {
  it('counts only phones the user actually typed', () => {
    const summary = directoryContactSummary({
      centres: [
        centre(),
        centre({ warrantyId: 'w2', phone: null, phoneSource: 'none', address: null }),
        centre({
          warrantyId: 'w3',
          phone: '0900000000',
          phoneSource: 'unknown',
          provider: null,
          providerInput: 'Chỗ nào cũng bảo hành',
        }),
      ],
    });
    expect(summary).toEqual({
      centres: 3,
      withUserPhone: 1,
      withoutPhone: 2,
      withUserAddress: 2,
      matchedProviders: 2,
      unmatchedProviders: 1,
    });
  });

  it('never lets the summary imply a hotline exists', () => {
    const line = directorySummaryLine(
      directoryContactSummary({ centres: [centre(), centre({ warrantyId: 'w2' })] }),
    );
    expect(line).toContain('2/2 gói có số điện thoại do bạn tự ghi');
    expect(line).toContain('App không có hotline nào');
  });

  it('uses the empty-state wording when there is no package at all', () => {
    expect(directorySummaryLine(directoryContactSummary({ centres: [] }))).toBe(DIRECTORY_NO_CENTRES);
  });
});

describe('warrantyTypeLabel', () => {
  it('uses the shared labels and falls back to the raw code', () => {
    expect(warrantyTypeLabel('STANDARD')).toBe('Tiêu chuẩn');
    expect(warrantyTypeLabel('EXTENDED')).toBe('Mở rộng');
    expect(warrantyTypeLabel('THIRD_PARTY')).toBe('Bên thứ ba');
    expect(warrantyTypeLabel('WEIRD')).toBe('WEIRD');
    expect(warrantyTypeLabel('')).toBe('Không rõ loại');
  });
});

describe('copy pins', () => {
  it('keeps the address honesty line that pairs with phoneSource', () => {
    expect(DIRECTORY_ADDRESS_NONE).toContain('Chưa ghi địa chỉ');
  });

  it('explains why a null brand is a valid answer', () => {
    expect(DIRECTORY_NO_ENTRY_DETAIL).toContain('mơ hồ');
    expect(DIRECTORY_NO_ENTRY_DETAIL).toContain('không đoán');
  });
});
