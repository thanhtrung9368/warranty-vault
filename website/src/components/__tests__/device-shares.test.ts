// Render-level tests for the share-link surface (FEATURE_IDEAS #2).
//
// The pure lifecycle/URL logic is covered in
// `@/lib/__tests__/share-links.test.ts`. What this file pins is the part that
// only exists in markup: that the one-time warning is on screen, that the
// dialog's close button is unusable until the owner acknowledges, and that a
// link row says what it exposes.
//
// `CreatedSharePanel` and `ShareRow` use no browser APIs, only the i18n hooks,
// so `renderToStaticMarkup` works without a DOM (the parent `DeviceShares` does
// use `useRouter`, and is deliberately not rendered here). Kept as `.ts` because
// vitest only collects `*.test.ts`.
//
// Language is pinned with `I18nProvider locale="vi"` (docs/I18N_PLAN.md §4.3):
// the assertions below quote the Vietnamese source sentences, and a bare render
// would fall back to the English default and fail for the wrong reason.

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The real server actions pull in `@/lib/auth-cookie`, which requires
// SESSION_SECRET at import time. Nothing here calls them — the markup under
// test only receives their handlers as props — so the module is stubbed.
vi.mock('@/app/actions/shares', () => ({
  createDeviceShare: async () => ({ ok: false, message: 'không gọi trong test' }),
  revokeDeviceShare: async () => ({ ok: false, message: 'không gọi trong test' }),
}));

import { CreatedSharePanel, ShareRow } from '@/components/device-shares';
import { Dialog } from '@/components/ui/dialog';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locale';
import type { CreatedDeviceShare, DeviceShare } from '@/lib/api/shares';
import { SHARE_ACK_LABEL, SHARE_CLOSE_BLOCKED_HINT, SHARE_ONE_TIME_WARNING } from '@/lib/share-links';

const URL = 'https://api.example.com/api/v1/public/shares/abc123token';

/** The Vietnamese source sentences are what the assertions below quote. */
const VI: Locale = 'vi';

/**
 * Render inside the provider so the copy under test is the Vietnamese source.
 *
 * The props are annotated because React 19's `createElement` overload for a
 * function component types `children` as required — the cast is what lets the
 * child travel as the third argument (where it belongs) instead of as a prop.
 */
function renderVi(element: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale: VI } as React.Attributes & { locale: Locale; children: React.ReactNode },
      element,
    ),
  );
}

const CREATED: CreatedDeviceShare = {
  id: 's1',
  deviceId: 'd1',
  expiresAt: '2099-07-15T12:00:00Z',
  revokedAt: null,
  includeSerial: false,
  viewCount: 0,
  lastViewedAt: null,
  createdAt: '2026-06-15T12:00:00Z',
  token: 'abc123token',
  sharePath: '/api/v1/public/shares/abc123token',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof CreatedSharePanel>> = {}) {
  // `DialogTitle`/`DialogDescription` read Radix's dialog context, so the panel
  // needs a Root around it even when rendered to static markup.
  return renderVi(
    React.createElement(
      Dialog,
      { open: true },
      React.createElement(CreatedSharePanel, {
        url: URL,
        share: CREATED,
        copied: false,
        ack: false,
        blocked: false,
        urlRef: React.createRef<HTMLInputElement>(),
        onCopy: () => {},
        onAck: () => {},
        onClose: () => {},
        ...overrides,
      }),
    ),
  );
}

/** The markup of the button whose label is `label`, so classes/attrs can be checked. */
function buttonWith(html: string, label: string): string {
  for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)) {
    if (match[0].includes(label)) return match[0];
  }
  return '';
}

/** True only for the real attribute — not for Tailwind's `disabled:` classes. */
function isDisabled(buttonMarkup: string): boolean {
  return /\sdisabled(=""|\s|>)/.test(buttonMarkup);
}

function renderRow(props: Partial<React.ComponentProps<typeof ShareRow>> = {}) {
  return renderVi(
    React.createElement(ShareRow, {
      share: CREATED,
      ...props,
    }),
  );
}

describe('CreatedSharePanel — the one-time token warning', () => {
  it('shows the link, the warning and the acknowledgement in the same view', () => {
    const html = renderPanel();
    expect(html).toContain(URL);
    expect(html).toContain(SHARE_ONE_TIME_WARNING);
    expect(html).toContain(SHARE_ACK_LABEL);
    // Never claim the token can be looked up again.
    expect(html).not.toContain('xem lại link');
  });

  it('offers a preview of exactly what the recipient will see', () => {
    const html = renderPanel();
    expect(html).toContain('Mở phiếu (xem trước)');
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps the close button disabled until the owner acknowledges', () => {
    const closeWhenUnacked = buttonWith(renderPanel({ ack: false }), 'Đóng');
    expect(closeWhenUnacked).not.toBe('');
    expect(isDisabled(closeWhenUnacked)).toBe(true);

    const closeWhenAcked = buttonWith(renderPanel({ ack: true }), 'Đóng');
    expect(isDisabled(closeWhenAcked)).toBe(false);
  });

  it('says why the dialog would not close when dismissal is attempted early', () => {
    expect(renderPanel({ blocked: true })).toContain(SHARE_CLOSE_BLOCKED_HINT);
    // No nag before the attempt.
    expect(renderPanel({ blocked: false })).not.toContain(SHARE_CLOSE_BLOCKED_HINT);
  });

  it('confirms the copy instead of re-enabling the same button silently', () => {
    const html = renderPanel({ copied: true });
    expect(html).toContain('Đã sao chép');
    expect(html).not.toContain('Sao chép link');
  });

  it('states the exposure of the link that was just created', () => {
    expect(renderPanel()).toContain('Chỉ serial che giữa');
    expect(renderPanel({ share: { ...CREATED, includeSerial: true } })).toContain(
      'Kèm serial/IMEI đầy đủ',
    );
  });
});

describe('ShareRow', () => {
  // Expiry far in the future: these assertions are about wording, and the row
  // derives live/expired from the real clock. (A `DeviceShare` is the list
  // projection and never carries the token, so it is built field by field.)
  const rowBase: DeviceShare = {
    id: CREATED.id,
    deviceId: CREATED.deviceId,
    expiresAt: '2099-07-15T12:00:00Z',
    revokedAt: null,
    includeSerial: false,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: CREATED.createdAt,
  };

  it('shows the live link as live, with what was exposed and who opened it', () => {
    const html = renderRow({ share: { ...rowBase, viewCount: 3 }, onRevoke: () => {} });
    expect(html).toContain('Đang hoạt động');
    expect(html).toContain('Đã mở 3 lần');
    expect(html).toContain('Chỉ serial che giữa');
    expect(html).toContain('Thu hồi');
  });

  it('omits the revoke action when the row is rendered read-only', () => {
    expect(renderRow({ share: rowBase })).not.toContain('Thu hồi');
  });

  it('marks an unopened link instead of printing "0 lần"', () => {
    expect(renderRow({ share: rowBase })).toContain('Chưa ai mở');
  });

  it('never offers revoke for a link that is already dead', () => {
    const expired = renderRow({
      share: { ...rowBase, expiresAt: '2020-01-01T00:00:00Z' },
      onRevoke: () => {},
    });
    expect(expired).toContain('Đã hết hạn');
    expect(expired).not.toContain('Thu hồi');

    const revoked = renderRow({
      share: { ...rowBase, revokedAt: '2026-06-01T00:00:00Z' },
      onRevoke: () => {},
    });
    expect(revoked).toContain('Đã thu hồi');
    expect(revoked).not.toContain('Thu hồi');
  });
});
