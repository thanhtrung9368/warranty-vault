// Render-level tests for the service-directory card (FEATURE_IDEAS #15).
//
// The pure helpers are covered in `@/lib/__tests__/service-directory.test.ts`;
// what this file adds is the part a helper test cannot see: that the card
// actually renders `phoneSource` and the null-brand case the way the copy says.
// `ServiceDirectoryCard` is a server component (no hooks, no browser APIs), so
// `renderToStaticMarkup` is enough — no DOM environment, no click-through, and
// no backend.
//
// Kept as `.ts` (React.createElement, no JSX) because vitest only collects
// `*.test.ts` here.

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ServiceDirectoryCard } from '@/components/service-directory-card';
import {
  DIRECTORY_NO_BRAND_INPUT_TITLE,
  DIRECTORY_NO_CENTRES,
  DIRECTORY_NO_ENTRY_TITLE,
  DIRECTORY_PHONE_HONESTY,
  DIRECTORY_PHONE_NONE_LABEL,
  DIRECTORY_PHONE_UNVERIFIED_LABEL,
  DIRECTORY_PHONE_USER_LABEL,
  normalizeServiceDirectory,
} from '@/lib/service-directory';

const DISCLAIMER =
  'App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành: những thông tin đó thay đổi liên tục.';

const RAW_CENTRE = {
  warrantyId: 'w1',
  warrantyType: 'STANDARD',
  endDate: '2027-06-15T12:00:00Z',
  isActive: true,
  providerInput: 'Samsung',
  provider: { id: 'samsung', name: 'Samsung' },
  address: '12 Nguyễn Huệ, Q.1',
  phone: '0901234567',
  phoneSource: 'user',
};

function render(raw: Record<string, unknown>): string {
  const directory = normalizeServiceDirectory({
    deviceId: 'd1',
    deviceName: 'iPhone 15',
    category: 'PHONE',
    disclaimer: DISCLAIMER,
    ...raw,
  });
  if (!directory) throw new Error('fixture did not normalise');
  return renderToStaticMarkup(
    React.createElement(ServiceDirectoryCard, { directory, unavailable: false }),
  );
}

describe('ServiceDirectoryCard — phoneSource', () => {
  it('marks a user-typed number as the user’s own, never as verified', () => {
    const html = render({ centres: [RAW_CENTRE] });
    expect(html).toContain('0901234567');
    expect(html).toContain(DIRECTORY_PHONE_USER_LABEL);
    expect(html).not.toContain(DIRECTORY_PHONE_NONE_LABEL);
    // The honesty line ships with the number.
    expect(html).toContain(DIRECTORY_PHONE_HONESTY);
  });

  it('renders phoneSource: none as "there is no number", with no digits to call', () => {
    const html = render({
      centres: [{ ...RAW_CENTRE, phone: null, phoneSource: 'none' }],
    });
    expect(html).toContain(DIRECTORY_PHONE_NONE_LABEL);
    expect(html).not.toContain(DIRECTORY_PHONE_USER_LABEL);
    // Nothing phone-shaped anywhere in the card: no invented hotline.
    expect(html).not.toMatch(/\d{9,}/);
  });

  it('flags a number whose source is unknown instead of vouching for it', () => {
    const html = render({ centres: [{ ...RAW_CENTRE, phoneSource: 'garbage' }] });
    expect(html).toContain('0901234567');
    expect(html).toContain(DIRECTORY_PHONE_UNVERIFIED_LABEL);
    expect(html).not.toContain(DIRECTORY_PHONE_USER_LABEL);
  });

  it('keeps the address honest too: user-recorded, or explicitly absent', () => {
    const withAddress = render({ centres: [RAW_CENTRE] });
    expect(withAddress).toContain('12 Nguyễn Huệ, Q.1');
    expect(withAddress).toContain('Địa chỉ do bạn tự ghi');

    const withoutAddress = render({
      centres: [{ ...RAW_CENTRE, address: null }],
    });
    expect(withoutAddress).toContain('Chưa ghi địa chỉ cho gói này.');
  });
});

describe('ServiceDirectoryCard — null brand', () => {
  it('explains a null brand and echoes what the user typed', () => {
    const html = render({ brand: null, brandInput: 'Hãng lạ', centres: [RAW_CENTRE] });
    expect(html).toContain(DIRECTORY_NO_ENTRY_TITLE);
    expect(html).toContain('Hãng lạ');
    // No invented link for a brand the app has no row for.
    expect(html).not.toContain('Tra cứu trung tâm bảo hành uỷ quyền');
  });

  it('asks for the brand when the device has none at all', () => {
    const html = render({ brand: null, brandInput: null, centres: [] });
    expect(html).toContain(DIRECTORY_NO_BRAND_INPUT_TITLE);
  });

  it('renders the official links when the brand did match', () => {
    const html = render({
      brandInput: 'Apple',
      brand: {
        brandId: 'apple',
        name: 'Apple',
        serviceLocatorUrl: 'https://support.apple.com/vi-vn',
        supportUrl: null,
        notes: 'Trang tra cứu TTBH uỷ quyền.',
      },
      centres: [RAW_CENTRE],
    });
    expect(html).toContain('Apple');
    expect(html).toContain('https://support.apple.com/vi-vn');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Trang tra cứu TTBH uỷ quyền.');
  });

  it('drops a brand row whose link is not http(s)', () => {
    const html = render({
      brandInput: 'X',
      brand: { brandId: 'x', name: 'X', serviceLocatorUrl: 'javascript:alert(1)' },
      centres: [],
    });
    expect(html).not.toContain('javascript:');
  });
});

describe('ServiceDirectoryCard — centres and disclaimer', () => {
  it('always shows the user’s provider text next to a null catalog row', () => {
    const html = render({
      centres: [{ ...RAW_CENTRE, provider: null, providerInput: 'TTBH FPT' }],
    });
    expect(html).toContain('TTBH FPT');
    expect(html).toContain('Chưa khớp danh bạ nhà bảo hành');
  });

  it('counts the phones the user actually typed', () => {
    const html = render({
      centres: [RAW_CENTRE, { ...RAW_CENTRE, warrantyId: 'w2', phone: null, phoneSource: 'none' }],
    });
    expect(html).toContain('1/2 gói có số điện thoại do bạn tự ghi');
    expect(html).toContain('App không có hotline nào');
  });

  it('surfaces the server disclaimer verbatim', () => {
    expect(render({ centres: [] })).toContain(DISCLAIMER);
  });

  it('uses the empty-state wording when the device has no warranty package', () => {
    expect(render({ centres: [] })).toContain(DIRECTORY_NO_CENTRES);
  });

  it('says "không tải được" instead of pretending an empty directory', () => {
    const html = renderToStaticMarkup(
      React.createElement(ServiceDirectoryCard, { directory: null, unavailable: true }),
    );
    expect(html).toContain('Không tải được danh bạ bảo hành');
  });
});
