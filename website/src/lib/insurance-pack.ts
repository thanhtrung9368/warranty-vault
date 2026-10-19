// Pure helpers for the insurance PDF pack.
//
// The browser control does not link straight at the Go API: the bearer token
// lives in an httpOnly iron-session cookie, so `/api/insurance-pack` proxies the
// bytes (see `app/api/insurance-pack/route.ts`) exactly like the attachment and
// backup downloads.
//
// Everything in this module is pure so it can be unit-tested without a server:
//   * `buildInsurancePackQuery` — the frozen contract's optional query string
//   * `parseInsurancePackScope`  — the same contract read back from a URL
//   * `insurancePackFilename`    — ASCII fallback name for the saved PDF
//   * `resolveInsurancePackFilename` — prefer the server's Content-Disposition
//   * `insurancePackCopy`        — the label/copy selector (VI + EN)
//
// The document is ALWAYS Vietnamese. That is a property of the artifact, not a
// missing translation: an insurer or loss adjuster reads it, and they did not
// choose a language in this app. The copy below says so next to the button.

import { format } from 'date-fns';
import { filenameFromDisposition } from '@/lib/backup-media';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

/** The optional query contract of `GET /api/v1/insurance-pack`. */
export type InsurancePackScope = {
  /** Omit for every device. IDs are joined with commas on the wire. */
  deviceIds?: readonly string[];
  /** Default false: the server lists only devices the user still owns. */
  includeSold?: boolean;
};

/** Every sentence the download control renders, already in `locale`. */
export type InsurancePackCopy = {
  button: string;
  description: string;
  /** One line explaining why the PDF is Vietnamese rather than the UI language. */
  vietnameseNote: string;
  includeSold: string;
  includeSoldHint: string;
  /** Human-readable summary of the selected scope. */
  scope: string;
  busy: string;
  success: string;
  failure: string;
  emptyFile: string;
  notPdf: string;
};

/**
 * Trim, drop blanks and de-duplicate device IDs while preserving the caller's
 * order. The API treats the value as a set; a repeated ID would only make the
 * query string longer.
 */
export function normalizeInsurancePackDeviceIds(
  ids: readonly string[] | null | undefined,
): string[] {
  if (!ids) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build the query string the Go endpoint accepts.
 *
 *   buildInsurancePackQuery()                          → ''
 *   buildInsurancePackQuery({ includeSold: true })     → '?includeSold=true'
 *   buildInsurancePackQuery({ deviceIds: ['a', 'b'] }) → '?deviceIds=a,b'
 *
 * `includeSold=false` is omitted rather than sent: false IS the server default,
 * and an absent parameter keeps the request identical to the pre-flag contract.
 * Each ID is percent-encoded individually but the comma separators are not, so
 * the value still reads like the contract's `<id>,<id>` example.
 */
export function buildInsurancePackQuery(scope: InsurancePackScope = {}): string {
  const parts: string[] = [];
  const ids = normalizeInsurancePackDeviceIds(scope.deviceIds);
  if (ids.length > 0) {
    parts.push(`deviceIds=${ids.map((id) => encodeURIComponent(id)).join(',')}`);
  }
  if (scope.includeSold === true) parts.push('includeSold=true');
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/**
 * Read the contract's query parameters back out of a request URL. Unknown
 * parameters are ignored on purpose: the proxy forwards only what the frozen
 * contract defines. `includeSold` accepts `true` and `1`; anything else is the
 * default (`false`).
 */
export function parseInsurancePackScope(params: URLSearchParams): InsurancePackScope {
  const rawIds = params.get('deviceIds') ?? '';
  const rawIncludeSold = (params.get('includeSold') ?? '').trim().toLowerCase();
  return {
    deviceIds: normalizeInsurancePackDeviceIds(rawIds.split(',')),
    includeSold: rawIncludeSold === 'true' || rawIncludeSold === '1',
  };
}

/**
 * Fallback filename, used when the server omits Content-Disposition. ASCII only
 * so it survives every OS: `warrly-insurance-pack-20260301-1430.pdf`.
 */
export function insurancePackFilename(at: Date = new Date()): string {
  return `warrly-insurance-pack-${format(at, 'yyyyMMdd-HHmm')}.pdf`;
}

/**
 * Prefer the filename Go chose, but only if it really names a PDF; otherwise
 * fall back to our own timestamped name. The returned value never contains a
 * directory separator, which also keeps a stray upstream header from becoming a
 * path in the browser's download folder.
 */
export function resolveInsurancePackFilename(
  disposition?: string | null,
  at: Date = new Date(),
): string {
  const fromServer = filenameFromDisposition(disposition)
    ?.split(/[\\/]/)
    .pop()
    ?.trim();
  if (fromServer && /\.pdf$/i.test(fromServer)) return fromServer;
  return insurancePackFilename(at);
}

/**
 * A real PDF starts with the five bytes `%PDF-` (ISO 32000). The proxy and the
 * browser control both use this so an HTML/JSON error page served with a 200
 * cannot be saved as a `.pdf` — a zero-byte or wrong-format file is the exact
 * failure this feature must make visible.
 */
export function hasPdfHeader(bytes: ArrayLike<number>): boolean {
  if (!bytes || bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //   -
  );
}

/**
 * The download control's copy, selected by the active UI language and the
 * include-sold toggle. Centralising it here is what keeps the Vietnamese source
 * strings out of the component and lets the tests pin both languages.
 */
export function insurancePackCopy(
  locale: Locale,
  includeSold = false,
): InsurancePackCopy {
  return {
    button: translate(locale, 'Bảng kê cho bảo hiểm (tiếng Việt)'),
    description: translate(
      locale,
      'Tải một file PDF để gửi cho công ty bảo hiểm khi họ yêu cầu bảng kê tài sản: trang bìa, bảng kê giá trị và giá mua, từng thiết bị kèm điều khoản bảo hành và ảnh, cùng danh mục file đính kèm.',
    ),
    vietnameseNote: translate(
      locale,
      'File PDF luôn ở tiếng Việt vì người đọc là công ty bảo hiểm hoặc giám định viên, không phải người dùng app.',
    ),
    includeSold: translate(locale, 'Bao gồm cả thiết bị đã bán'),
    includeSoldHint: translate(
      locale,
      'Mặc định chỉ liệt kê thiết bị bạn đang sở hữu. Bật nếu hồ sơ bảo hiểm cần cả tài sản đã bán trong kỳ.',
    ),
    scope: includeSold
      ? translate(locale, 'Phạm vi: tất cả thiết bị, kể cả đã bán.')
      : translate(locale, 'Phạm vi: tất cả thiết bị đang sở hữu.'),
    busy: translate(locale, 'Đang tạo bảng kê…'),
    success: translate(locale, 'Đã tải bảng kê cho bảo hiểm'),
    failure: translate(locale, 'Không tải được bảng kê cho bảo hiểm.'),
    emptyFile: translate(locale, 'File tải về trống — thử lại nhé.'),
    notPdf: translate(
      locale,
      'Máy chủ trả về một file không phải PDF — thử lại nhé.',
    ),
  };
}

/**
 * Error text for a failed proxy response. Go's JSON `message` wins when it is
 * present (the route forwards it in the user's language); otherwise we generate
 * a sentence that names the HTTP status, so a bare failure is still actionable.
 */
export function insurancePackFailureMessage(
  locale: Locale,
  status: number,
  upstreamMessage?: string | null,
): string {
  const message = upstreamMessage?.trim();
  if (message) return message;
  return translate(locale, 'Không tải được bảng kê cho bảo hiểm (mã lỗi {status}).', {
    status,
  });
}
