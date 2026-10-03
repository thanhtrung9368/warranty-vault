import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEVICE_LABEL,
  MAX_DEVICE_LABEL_BYTES,
  UNKNOWN_DEVICE_LABEL,
  UNKNOWN_PLATFORM_LABEL,
  deviceLabelFromUserAgent,
  sessionDeviceLabel,
  sessionPlatformLabel,
  sessionRevokeOutcome,
  truncateDeviceLabel,
  utf8ByteLength,
} from '@/lib/sessions';

// `GET /api/v1/auth/sessions` rows + the `deviceLabel` we send at login.

describe('sessionDeviceLabel', () => {
  it('uses the label the client sent', () => {
    expect(sessionDeviceLabel('Chrome · macOS')).toBe('Chrome · macOS');
  });

  it('falls back for null / undefined / blank — the documented copy', () => {
    expect(sessionDeviceLabel(null)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(sessionDeviceLabel(undefined)).toBe(UNKNOWN_DEVICE_LABEL);
    expect(sessionDeviceLabel('')).toBe(UNKNOWN_DEVICE_LABEL);
    expect(sessionDeviceLabel('   ')).toBe(UNKNOWN_DEVICE_LABEL);
  });

  it('trims without rewriting a real label', () => {
    expect(sessionDeviceLabel('  Safari · iPad  ')).toBe('Safari · iPad');
  });
});

describe('sessionPlatformLabel', () => {
  it('maps the three platform values Go can store', () => {
    expect(sessionPlatformLabel('web')).toBe('Trình duyệt web');
    expect(sessionPlatformLabel('ios')).toBe('iPhone / iPad');
    expect(sessionPlatformLabel('android')).toBe('Android');
  });

  it('never returns an empty string for a missing platform', () => {
    expect(sessionPlatformLabel(null)).toBe(UNKNOWN_PLATFORM_LABEL);
    expect(sessionPlatformLabel(undefined)).toBe(UNKNOWN_PLATFORM_LABEL);
    expect(sessionPlatformLabel('')).toBe(UNKNOWN_PLATFORM_LABEL);
  });

  it('passes an unknown value through instead of guessing', () => {
    // `normalizePlatform` maps anything outside web/ios/android to nil, so this
    // is a defensive branch only — and it must not invent a mapping (in
    // particular not the push vocabulary `apns`/`fcm`, which belongs to
    // PushSubscription.platform, a different entity).
    expect(sessionPlatformLabel('symbian')).toBe('symbian');
    expect(sessionPlatformLabel('apns')).toBe('apns');
  });
});

describe('utf8ByteLength / truncateDeviceLabel', () => {
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('·')).toBe(2);
    expect(utf8ByteLength('Trình duyệt')).toBe(
      Buffer.byteLength('Trình duyệt', 'utf8'),
    );
  });

  it('truncates on a character boundary at the 80-byte server cap', () => {
    const long = 'Trình duyệt web · '.repeat(10);
    const cut = truncateDeviceLabel(long);
    expect(utf8ByteLength(cut)).toBeLessThanOrEqual(MAX_DEVICE_LABEL_BYTES);
    // No U+FFFD and no lone surrogate: the cut value round-trips unchanged.
    expect(cut).toBe(Buffer.from(cut, 'utf8').toString('utf8'));
    expect(cut.startsWith('Trình duyệt web')).toBe(true);
  });

  it('leaves a short label untouched', () => {
    expect(truncateDeviceLabel('Chrome · macOS')).toBe('Chrome · macOS');
  });
});

describe('deviceLabelFromUserAgent', () => {
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const CHROME_ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const EDGE_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
  const FIREFOX_LINUX =
    'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';

  it('names the browser and the OS', () => {
    expect(deviceLabelFromUserAgent(CHROME_MAC)).toBe('Chrome · macOS');
    expect(deviceLabelFromUserAgent(SAFARI_IPHONE)).toBe('Safari · iPhone');
    expect(deviceLabelFromUserAgent(CHROME_ANDROID)).toBe('Chrome · Android');
    expect(deviceLabelFromUserAgent(FIREFOX_LINUX)).toBe('Firefox · Linux');
  });

  it('does not mistake Edge/Chrome for Safari or Android for Linux', () => {
    expect(deviceLabelFromUserAgent(EDGE_WINDOWS)).toBe('Edge · Windows');
    // Chrome on iOS reports CriOS, not Chrome/.
    expect(
      deviceLabelFromUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Chrome · iPhone');
    // A bare Safari token without Version/ is not Safari.
    expect(deviceLabelFromUserAgent('Safari/605.1.15')).toBe(DEFAULT_DEVICE_LABEL);
  });

  it('falls back to a generic label when the UA is missing or unreadable', () => {
    expect(deviceLabelFromUserAgent(null)).toBe(DEFAULT_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent(undefined)).toBe(DEFAULT_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent('   ')).toBe(DEFAULT_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent('curl/8.4.0')).toBe(DEFAULT_DEVICE_LABEL);
  });

  it('keeps partial information rather than dropping the label', () => {
    // Browser known, OS not.
    expect(deviceLabelFromUserAgent('Chrome/131.0.0.0')).toBe('Chrome');
    // OS known, browser not.
    expect(deviceLabelFromUserAgent('(Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });

  it('is never longer than the server cap, and is never the null fallback', () => {
    const label = deviceLabelFromUserAgent(`${CHROME_MAC} ${'x'.repeat(400)}`);
    expect(utf8ByteLength(label)).toBeLessThanOrEqual(MAX_DEVICE_LABEL_BYTES);
    expect(label).not.toBe(UNKNOWN_DEVICE_LABEL);
  });
});

describe('sessionRevokeOutcome', () => {
  it('flags the current session so the caller can log out', () => {
    const out = sessionRevokeOutcome({
      ok: true,
      current: true,
      alreadyRevoked: false,
      message: 'Đã thu hồi phiên đăng nhập. Đây là phiên bạn đang dùng — hãy đăng nhập lại.',
    });
    expect(out.kind).toBe('current');
    expect(out.message).toContain('đăng nhập lại');
  });

  it('treats alreadyRevoked as success, not an error', () => {
    const out = sessionRevokeOutcome({
      ok: true,
      current: false,
      alreadyRevoked: true,
      message: 'Phiên đăng nhập này đã được thu hồi trước đó.',
    });
    expect(out.kind).toBe('already');
    expect(out.message).toBe('Phiên đăng nhập này đã được thu hồi trước đó.');
  });

  it('maps a plain revoke of another session', () => {
    const out = sessionRevokeOutcome({
      ok: true,
      current: false,
      alreadyRevoked: false,
      message: 'Đã thu hồi phiên đăng nhập.',
    });
    expect(out.kind).toBe('revoked');
  });

  it('treats current + alreadyRevoked as current (token is dead either way)', () => {
    const out = sessionRevokeOutcome({
      ok: true,
      current: true,
      alreadyRevoked: true,
      message: '',
    });
    expect(out.kind).toBe('current');
    expect(out.message).not.toBe('');
  });

  it('falls back to Vietnamese copy when the API sent no message', () => {
    expect(
      sessionRevokeOutcome({ ok: true, current: false, alreadyRevoked: false, message: '' })
        .message,
    ).toBe('Đã thu hồi phiên đăng nhập.');
    expect(
      sessionRevokeOutcome({ ok: true, current: false, alreadyRevoked: true, message: '  ' })
        .message,
    ).toBe('Phiên đăng nhập này đã được thu hồi trước đó.');
  });
});
