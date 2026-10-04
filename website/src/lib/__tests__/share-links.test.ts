import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_NEVER_SHOWN,
  CERTIFICATE_SHOWS,
  SHARE_LIMIT_NOTE,
  MAX_ACTIVE_SHARES_PER_DEVICE,
  SHARE_ACK_LABEL,
  SHARE_CLOSE_BLOCKED_HINT,
  SHARE_ONE_TIME_WARNING,
  SHARE_SERIAL_OFF_NOTE,
  SHARE_SERIAL_ON_NOTE,
  SHARE_TTL_DEFAULT_DAYS,
  SHARE_TTL_MAX_DAYS,
  SHARE_TTL_MIN_DAYS,
  shareCapacity,
  shareCertificateUrl,
  shareIsLive,
  shareRemainingLabel,
  shareSerialExposureLabel,
  shareStatus,
  shareStatusLabel,
  shareStatusTone,
  shareTokenFromPath,
  shareViewLabel,
  normalizeShareExpiryDays,
  SHARE_EXPIRY_CHOICES,
  splitShares,
  type ShareLike,
} from '@/lib/share-links';

const NOW = new Date('2026-06-15T12:00:00Z');

// Language is pinned explicitly ('vi') on every message-producing helper
// (docs/I18N_PLAN.md §4.3): these assertions are about the Vietnamese source
// sentences, so they must not drift with the default locale. URL/expiry/
// capacity helpers take no locale — they produce no prose.

function share(overrides: Partial<ShareLike> = {}): ShareLike {
  return {
    id: 's1',
    expiresAt: '2026-07-15T12:00:00Z',
    revokedAt: null,
    includeSerial: false,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: '2026-06-15T12:00:00Z',
    ...overrides,
  };
}

describe('shareCertificateUrl', () => {
  // The bug this guards: GO_API_URL already ends with `/api` and sharePath
  // already starts with `/api/v1/...` — naive concatenation yields
  // `/api/api/v1/public/shares/x` and every link 404s.
  it('does not double the /api prefix', () => {
    expect(
      shareCertificateUrl('http://localhost:4000/api', '/api/v1/public/shares/abc123'),
    ).toBe('http://localhost:4000/api/v1/public/shares/abc123');
  });

  it('keeps a reverse-proxy prefix that sits before /api', () => {
    expect(
      shareCertificateUrl('https://gw.example.com/backend/api', '/api/v1/public/shares/abc123'),
    ).toBe('https://gw.example.com/backend/api/v1/public/shares/abc123');
  });

  it('works when the API base has no /api suffix at all (code fallback)', () => {
    expect(shareCertificateUrl('http://localhost:4000', '/api/v1/public/shares/abc123')).toBe(
      'http://localhost:4000/api/v1/public/shares/abc123',
    );
  });

  it('ignores a trailing slash on the base', () => {
    expect(
      shareCertificateUrl('https://api.example.com/api/', '/api/v1/public/shares/abc123'),
    ).toBe('https://api.example.com/api/v1/public/shares/abc123');
  });

  it('adds /api when the server returns a /v1 path and the base lacks the prefix', () => {
    expect(shareCertificateUrl('https://api.example.com', '/v1/public/shares/abc123')).toBe(
      'https://api.example.com/api/v1/public/shares/abc123',
    );
  });

  it('does not add /api twice for a /v1 path when the base already has it', () => {
    expect(shareCertificateUrl('https://api.example.com/api', '/v1/public/shares/abc123')).toBe(
      'https://api.example.com/api/v1/public/shares/abc123',
    );
  });

  it('leaves an already-absolute sharePath untouched', () => {
    expect(
      shareCertificateUrl('http://localhost:4000/api', 'https://api.example.com/api/v1/public/shares/x'),
    ).toBe('https://api.example.com/api/v1/public/shares/x');
  });

  it('returns the raw path when no usable API base exists', () => {
    expect(shareCertificateUrl('', '/api/v1/public/shares/abc123')).toBe(
      '/api/v1/public/shares/abc123',
    );
    expect(shareCertificateUrl(undefined, '/api/v1/public/shares/abc123')).toBe(
      '/api/v1/public/shares/abc123',
    );
    expect(shareCertificateUrl('api:4000', '/api/v1/public/shares/abc123')).toBe(
      '/api/v1/public/shares/abc123',
    );
  });

  it('returns an empty string for an empty path', () => {
    expect(shareCertificateUrl('http://localhost:4000/api', '')).toBe('');
    expect(shareCertificateUrl('http://localhost:4000/api', '   ')).toBe('');
  });
});

describe('shareTokenFromPath', () => {
  it('takes the last path segment', () => {
    expect(shareTokenFromPath('/api/v1/public/shares/abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('ignores a querystring or fragment', () => {
    expect(shareTokenFromPath('/api/v1/public/shares/abc123?utm=zalo#top')).toBe('abc123');
  });

  it('returns empty for a path with no segment', () => {
    expect(shareTokenFromPath('/')).toBe('');
    expect(shareTokenFromPath('')).toBe('');
  });
});

describe('normalizeShareExpiryDays', () => {
  it('keeps any value inside the documented 1..90 window', () => {
    expect(normalizeShareExpiryDays(1)).toBe(1);
    expect(normalizeShareExpiryDays(45)).toBe(45);
    expect(normalizeShareExpiryDays(90)).toBe(90);
    expect(normalizeShareExpiryDays('14')).toBe(14);
  });

  it('falls back to the 30-day default for missing / unusable values', () => {
    expect(normalizeShareExpiryDays(undefined)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays(null)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays('')).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays('ba mươi')).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays(Number.NaN)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays(true)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays({ days: 7 })).toBe(SHARE_TTL_DEFAULT_DAYS);
  });

  it('refuses out-of-range values instead of clamping them into a link the user did not ask for', () => {
    expect(normalizeShareExpiryDays(0)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays(-5)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays(91)).toBe(SHARE_TTL_DEFAULT_DAYS);
    expect(normalizeShareExpiryDays(3650)).toBe(SHARE_TTL_DEFAULT_DAYS);
  });

  it('truncates a fractional day', () => {
    expect(normalizeShareExpiryDays(7.9)).toBe(7);
  });

  it('states the cap and the bounds as an interpolatable template', () => {
    // The sentence is a dictionary key carrying `{max}`/`{min}`/`{maxDays}`
    // placeholders, so the numbers and the wording cannot drift apart.
    expect(SHARE_LIMIT_NOTE).toContain('{max} link còn hiệu lực');
    expect(MAX_ACTIVE_SHARES_PER_DEVICE).toBe(10);
    expect(SHARE_TTL_MIN_DAYS).toBe(1);
    expect(SHARE_TTL_MAX_DAYS).toBe(90);
  });

  it('offers only choices inside the window (and preselects the server default)', () => {
    for (const choice of SHARE_EXPIRY_CHOICES) {
      expect(choice.days).toBeGreaterThanOrEqual(SHARE_TTL_MIN_DAYS);
      expect(choice.days).toBeLessThanOrEqual(SHARE_TTL_MAX_DAYS);
    }
    expect(SHARE_EXPIRY_CHOICES.map((c) => c.days)).toContain(SHARE_TTL_DEFAULT_DAYS);
  });
});

describe('shareStatus', () => {
  it('is live before expiry', () => {
    expect(shareStatus(share(), NOW)).toBe('live');
    expect(shareIsLive(share(), NOW)).toBe(true);
  });

  it('is expired at and after the expiry instant', () => {
    expect(shareStatus(share({ expiresAt: '2026-06-15T12:00:00Z' }), NOW)).toBe('expired');
    expect(shareStatus(share({ expiresAt: '2026-06-15T11:59:59Z' }), NOW)).toBe('expired');
  });

  it('is revoked as soon as revokedAt is set, even before expiry', () => {
    const revoked = share({ revokedAt: '2026-06-16T00:00:00Z' });
    expect(shareStatus(revoked, NOW)).toBe('revoked');
    expect(shareIsLive(revoked, NOW)).toBe(false);
  });

  it('keeps revoked winning over expired', () => {
    expect(
      shareStatus(share({ expiresAt: '2026-06-01T00:00:00Z', revokedAt: '2026-06-02T00:00:00Z' }), NOW),
    ).toBe('revoked');
  });

  it('treats an unparseable expiry as expired (safe direction for a credential)', () => {
    expect(shareStatus(share({ expiresAt: 'not-a-date' }), NOW)).toBe('expired');
    expect(shareStatus(share({ expiresAt: '' }), NOW)).toBe('expired');
  });

  it('labels and tones each state', () => {
    expect(shareStatusLabel(share(), 'vi', NOW)).toBe('Đang hoạt động');
    expect(shareStatusTone(share(), NOW)).toBe('emerald');
    expect(shareStatusLabel(share({ expiresAt: '2026-01-01T00:00:00Z' }), 'vi', NOW)).toBe(
      'Đã hết hạn',
    );
    expect(shareStatusTone(share({ expiresAt: '2026-01-01T00:00:00Z' }), NOW)).toBe('zinc');
    expect(shareStatusLabel(share({ revokedAt: '2026-06-01T00:00:00Z' }), 'vi', NOW)).toBe(
      'Đã thu hồi',
    );
    expect(shareStatusTone(share({ revokedAt: '2026-06-01T00:00:00Z' }), NOW)).toBe('rose');
  });
});

describe('splitShares / shareCapacity', () => {
  const live1 = share({ id: 'a' });
  const live2 = share({ id: 'b', expiresAt: '2026-08-01T00:00:00Z' });
  const expired = share({ id: 'c', expiresAt: '2026-01-01T00:00:00Z' });
  const revoked = share({ id: 'd', revokedAt: '2026-06-01T00:00:00Z' });

  it('splits live from dead, preserving API order inside each group', () => {
    const { live, dead } = splitShares([live1, expired, live2, revoked], NOW);
    expect(live.map((s) => s.id)).toEqual(['a', 'b']);
    expect(dead.map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('counts only live links against the per-device cap', () => {
    expect(shareCapacity([live1, expired, revoked], NOW)).toEqual({
      liveCount: 1,
      remaining: MAX_ACTIVE_SHARES_PER_DEVICE - 1,
      full: false,
    });
  });

  it('reports full at the cap', () => {
    const full = Array.from({ length: MAX_ACTIVE_SHARES_PER_DEVICE }, (_, i) =>
      share({ id: `s${i}`, expiresAt: '2026-08-01T00:00:00Z' }),
    );
    expect(shareCapacity(full, NOW)).toEqual({
      liveCount: MAX_ACTIVE_SHARES_PER_DEVICE,
      remaining: 0,
      full: true,
    });
  });

  it('is empty-but-not-full with no shares at all', () => {
    expect(shareCapacity([], NOW)).toEqual({
      liveCount: 0,
      remaining: MAX_ACTIVE_SHARES_PER_DEVICE,
      full: false,
    });
  });
});

describe('shareRemainingLabel', () => {
  it('counts whole days left', () => {
    expect(shareRemainingLabel(share({ expiresAt: '2026-06-20T12:00:00Z' }), 'vi', NOW)).toBe(
      'Còn 5 ngày',
    );
  });

  it('says "dưới 1 ngày" instead of "0 ngày"', () => {
    expect(shareRemainingLabel(share({ expiresAt: '2026-06-15T20:00:00Z' }), 'vi', NOW)).toBe(
      'Còn dưới 1 ngày',
    );
  });

  it('has no countdown once the link is not live', () => {
    expect(shareRemainingLabel(share({ expiresAt: '2026-06-01T00:00:00Z' }), 'vi', NOW)).toBeNull();
    expect(shareRemainingLabel(share({ revokedAt: '2026-06-01T00:00:00Z' }), 'vi', NOW)).toBeNull();
    expect(shareRemainingLabel(share({ expiresAt: 'garbage' }), 'vi', NOW)).toBeNull();
  });
});

describe('shareViewLabel / shareSerialExposureLabel', () => {
  it('never reports a view that did not happen', () => {
    expect(shareViewLabel(0, 'vi')).toBe('Chưa ai mở');
    expect(shareViewLabel(undefined, 'vi')).toBe('Chưa ai mở');
    expect(shareViewLabel(null, 'vi')).toBe('Chưa ai mở');
    expect(shareViewLabel(1, 'vi')).toBe('Đã mở 1 lần');
    expect(shareViewLabel(7, 'vi')).toBe('Đã mở 7 lần');
  });

  it('defends against a negative / fractional count', () => {
    expect(shareViewLabel(-3, 'vi')).toBe('Chưa ai mở');
    expect(shareViewLabel(2.7, 'vi')).toBe('Đã mở 2 lần');
  });

  it('states the serial exposure in the owner-facing words', () => {
    expect(shareSerialExposureLabel(false, 'vi')).toBe('Chỉ serial che giữa');
    expect(shareSerialExposureLabel(undefined, 'vi')).toBe('Chỉ serial che giữa');
    expect(shareSerialExposureLabel(true, 'vi')).toBe('Kèm serial/IMEI đầy đủ');
  });
});

describe('the copy that makes the one-time token unmissable', () => {
  it('says the link is shown once, cannot be recovered, and requires a new link', () => {
    const w = SHARE_ONE_TIME_WARNING;
    expect(w).toContain('MỘT LẦN');
    expect(w).toContain('không ai');
    expect(w).toContain('xem lại được');
    expect(w).toContain('tạo link mới');
  });

  it('blocks dismissal with an instruction, not a silent close', () => {
    expect(SHARE_CLOSE_BLOCKED_HINT).toContain('Sao chép link');
    expect(SHARE_ACK_LABEL).toContain('không xem lại được');
  });

  it('explains the serial switch in both directions', () => {
    expect(SHARE_SERIAL_OFF_NOTE).toContain('che giữa');
    expect(SHARE_SERIAL_ON_NOTE).toContain('IMEI');
    expect(SHARE_SERIAL_ON_NOTE).toContain('chuyển tiếp');
  });

  it('names what the buyer gets and what never leaves the account', () => {
    expect(CERTIFICATE_SHOWS.join(' ')).toContain('Ngày hết hạn bảo hành xa nhất');
    const never = CERTIFICATE_NEVER_SHOWN.join(' ');
    expect(never).toContain('Giá mua');
    expect(never).toContain('Ảnh hoá đơn');
    expect(never).toContain('Ghi chú');
    // The certificate's own contract: no money, no notes, no attachments.
    expect(never).not.toContain('Serial');
  });
});
