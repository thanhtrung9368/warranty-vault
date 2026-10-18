import { describe, expect, it } from 'vitest';
import {
  buildHandoverChecklist,
  handoverPrepKind,
  type HandoverChecklistInput,
  type HandoverItemId,
} from '@/lib/handover-checklist';
import { formatDate } from '@/lib/format';

// The handover checklist is pure data + translation, so it is fully testable.
// The browser half — ticks in React state — is not rendered here (the app has
// no DOM test setup); these tests pin the generated content instead.

const PHONE: HandoverChecklistInput = {
  category: 'PHONE',
  serialNumber: '356938035643809',
  purchasePlace: 'FPT Shop',
  warrantyEnd: '2026-10-18T00:00:00',
};

const LAPTOP: HandoverChecklistInput = {
  category: 'LAPTOP',
  serialNumber: 'C02X1234JGH5',
  purchasePlace: 'CellphoneS',
  warrantyEnd: '2027-01-05T00:00:00',
};

const WASHING: HandoverChecklistInput = {
  category: 'WASHING',
  serialNumber: 'WM-2024-001',
  purchasePlace: 'Nguyen Kim',
  warrantyEnd: '2028-03-01T00:00:00',
};

const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

function itemIds(checklist: ReturnType<typeof buildHandoverChecklist>): HandoverItemId[] {
  return checklist.groups.flatMap((group) =>
    group.items.map((item) => item.id),
  );
}

function allText(checklist: ReturnType<typeof buildHandoverChecklist>): string[] {
  return checklist.groups.flatMap((group) => [
    group.title,
    ...group.items.flatMap((item) => [item.title, item.detail ?? '']),
  ]);
}

describe('handoverPrepKind', () => {
  it('treats phones, tablets and watches as account-bearing devices', () => {
    expect(handoverPrepKind('PHONE')).toBe('phone');
    expect(handoverPrepKind('TABLET')).toBe('phone');
    expect(handoverPrepKind('SMARTWATCH')).toBe('phone');
  });

  it('gives laptops their own account/disk-encryption story', () => {
    expect(handoverPrepKind('LAPTOP')).toBe('computer');
  });

  it('omits the data group for appliances and unknown categories', () => {
    expect(handoverPrepKind('WASHING')).toBe('none');
    expect(handoverPrepKind('FRIDGE')).toBe('none');
    expect(handoverPrepKind(null)).toBe('none');
    expect(handoverPrepKind('')).toBe('none');
  });
});

describe('phone checklist', () => {
  const checklist = buildHandoverChecklist(PHONE, 'vi');

  it('has the five sections and the expected count', () => {
    expect(checklist.groups.map((group) => group.id)).toEqual([
      'data',
      'condition',
      'paperwork',
      'counter',
      'pickup',
    ]);
    expect(checklist.total).toBe(17);
    expect(itemIds(checklist)).toHaveLength(17);
  });

  it('covers every item the brief asks for, in a useful order', () => {
    const ids = itemIds(checklist);
    expect(ids.slice(0, 6)).toEqual([
      'backup',
      'sign-out',
      'activation-lock',
      'passcode',
      'two-factor',
      'reset',
    ]);
    expect(ids).toContain('photos');
    expect(ids).toContain('faults');
    expect(ids).toContain('invoice');
    expect(ids).toContain('box');
    expect(ids).toContain('warranty-end');
    expect(ids).toContain('accessories');
    expect(ids).toContain('intake-slip');
    expect(ids).toContain('pickup-check');
  });

  it('signs out of iCloud, Google and Mi, and removes the passcode/biometrics', () => {
    const text = allText(checklist).join('\n');
    expect(text).toContain('iCloud, Google và Mi Cloud');
    expect(text).toContain('passcode');
    expect(text).toContain('Face ID/Touch ID');
    expect(text).toContain('khoá sinh trắc học');
  });

  it('adds Activation Lock / FRP and the 2FA/eSIM warning', () => {
    const text = allText(checklist).join('\n');
    expect(text).toContain('Activation Lock/FRP');
    expect(text).toContain('Find My iPhone/Find My Device');
    expect(text).toContain('2FA');
    expect(text).toContain('eSIM');
  });

  it('puts the device facts into the right items', () => {
    const text = allText(checklist).join('\n');
    const end = formatDate(PHONE.warrantyEnd!, 'vi');
    expect(text).toContain('356938035643809');
    expect(text).toContain('FPT Shop');
    expect(text).toContain(end);
    expect(text).toContain('hộp máy');
  });

  it('keeps item ids unique so checkbox keys cannot collide', () => {
    const ids = itemIds(checklist);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('laptop checklist', () => {
  const checklist = buildHandoverChecklist(LAPTOP, 'vi');

  it('swaps the phone account copy for Microsoft, Find My Mac, MDM and BitLocker', () => {
    const text = allText(checklist).join('\n');
    expect(text).toContain('Microsoft');
    expect(text).toContain('Find My Mac');
    expect(text).toContain('và khoá kích hoạt');
    expect(text).toContain('MDM');
    expect(text).toContain('BitLocker');
    expect(text).toContain('recovery key');
    expect(text).toContain('Gỡ mật khẩu đăng nhập');
    expect(text).not.toContain('Mi Cloud');
  });

  it('keeps the same total and item ids as the phone list', () => {
    const phone = buildHandoverChecklist(PHONE, 'vi');
    expect(checklist.total).toBe(17);
    expect(itemIds(checklist)).toEqual(itemIds(phone));
  });
});

describe('appliance checklist', () => {
  const checklist = buildHandoverChecklist(WASHING, 'vi');

  it('omits the data/account group entirely', () => {
    expect(checklist.groups.map((group) => group.id)).toEqual([
      'condition',
      'paperwork',
      'counter',
      'pickup',
    ]);
    expect(checklist.total).toBe(11);
    expect(allText(checklist).join('\n')).not.toContain('iCloud');
  });

  it('still carries condition, paperwork, accessories and warranty end', () => {
    const text = allText(checklist).join('\n');
    expect(text).toContain('Chụp ảnh');
    expect(text).toContain('hoá đơn');
    expect(text).toContain('phụ kiện');
    expect(text).toContain('Nguyen Kim');
    expect(text).toContain('ngày hết bảo hành');
  });
});

describe('missing device facts', () => {
  it('falls back to generic invoice/box/warranty copy instead of empty placeholders', () => {
    const checklist = buildHandoverChecklist({ category: 'TABLET' }, 'vi');
    const text = allText(checklist).join('\n');
    expect(text).toContain('Mang hoá đơn hoặc email xác nhận đơn hàng');
    expect(text).toContain('Mang hộp máy có serial/IMEI khớp với máy và hoá đơn');
    expect(text).toContain('App chưa có ngày hết bảo hành');
    expect(text).not.toContain('{place}');
    expect(text).not.toContain('{serial}');
    expect(text).not.toContain('{date}');
  });

  it('treats an unparseable warranty date as missing rather than printing Invalid Date', () => {
    const checklist = buildHandoverChecklist(
      { category: 'PHONE', warrantyEnd: 'not-a-date' },
      'vi',
    );
    const text = allText(checklist).join('\n');
    expect(text).toContain('App chưa có ngày hết bảo hành');
    expect(text).not.toContain('Invalid Date');
  });
});

describe('both languages', () => {
  it('produces the same structure in English and Vietnamese', () => {
    const vi = buildHandoverChecklist(PHONE, 'vi');
    const en = buildHandoverChecklist(PHONE, 'en');
    expect(itemIds(en)).toEqual(itemIds(vi));
    expect(en.total).toBe(vi.total);
    expect(en.groups.map((group) => group.title)).not.toEqual(
      vi.groups.map((group) => group.title),
    );
  });

  it('leaves no English string in Vietnamese', () => {
    for (const input of [PHONE, LAPTOP, WASHING]) {
      const en = buildHandoverChecklist(input, 'en');
      for (const text of allText(en)) {
        expect(text.trim()).not.toBe('');
        expect(text).not.toMatch(VIETNAMESE_ONLY);
      }
    }
  });

  it('renders the Vietnamese source verbatim', () => {
    const vi = buildHandoverChecklist(PHONE, 'vi');
    expect(allText(vi).join('\n')).toContain('Cửa hàng có thể xoá dữ liệu');
  });
});
