// Presentation logic for "Soát gói đăng ký" (openapi `SubscriptionAudit`).
//
// Pure + synchronous, so the rules can be unit-tested without a backend — same
// shape as `action-queue.ts`.
//
// ⚠️ What this module must never do: turn a finding into a claim about USAGE.
// The app has no usage telemetry, and the Go endpoint deliberately says "lâu rồi
// không thấy ghi nhận gì" instead of "bạn không dùng gói này". Everything the UI
// shows about a finding is either the server's own `title`/`detail`/`note` or a
// factual label derived from a machine code below (threshold, reason, material).
// There is also no "cancel" affordance anywhere in this feature — `advisory` is
// always true, and the endpoint has no write path.

// Type-only: a pure module stays importable without the API client's session
// machinery.
import type {
  SubscriptionAudit,
  SubscriptionAuditFinding,
  SubscriptionAuditThresholds,
} from '@/lib/api/subscriptions';
// Locale-aware copy. `locale` is a REQUIRED parameter on every function that
// returns a sentence (docs/I18N.md): an optional parameter with a Vietnamese
// default would let a missed call site render Vietnamese inside an English page
// and report nothing.
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export type AuditTone = 'rose' | 'amber' | 'zinc';

const SEVERITY_TONE: Record<string, AuditTone> = {
  HIGH: 'rose',
  MEDIUM: 'amber',
  LOW: 'zinc',
};

// A small, non-material price rise must not look like an alert: the server keeps
// returning the finding and leaves prominence to the client, so `material: false`
// deliberately downgrades it to the neutral tone.
export function isMinorPriceRise(
  finding: Pick<SubscriptionAuditFinding, 'kind' | 'material'>,
): boolean {
  return finding.kind === 'PRICE_INCREASED' && finding.material === false;
}

export function findingTone(
  finding: Pick<SubscriptionAuditFinding, 'kind' | 'severity' | 'material'>,
): AuditTone {
  if (isMinorPriceRise(finding)) return 'zinc';
  return SEVERITY_TONE[finding.severity] ?? 'zinc';
}

// Short qualifier rendered next to the title, derived from the machine codes the
// server sends (`material`, `reason`) — never from prose invented here.
export function findingTag(
  finding: Pick<SubscriptionAuditFinding, 'kind' | 'material' | 'reason'>,
  locale: Locale,
): string | null {
  switch (finding.kind) {
    case 'PRICE_INCREASED':
      return translate(locale, finding.material === false ? 'Mức tăng nhỏ' : 'Đáng chú ý');
    case 'DUPLICATE':
      if (finding.reason === 'SAME_NAME') return translate(locale, 'Trùng tên');
      if (finding.reason === 'SAME_BRAND_CATEGORY') return translate(locale, 'Cùng hãng, cùng loại');
      return translate(locale, 'Có thể trùng nhau');
    case 'QUIET_AUTO_RENEW':
      return translate(locale, 'Chỉ tư vấn');
    default:
      return null;
  }
}

// Which subscription each finding is about. `subscriptionIds` and `names` are
// parallel arrays (two entries for DUPLICATE); zip them defensively so a short
// or missing `names` array can never produce an undefined label.
export function findingSubjects(
  finding: Pick<SubscriptionAuditFinding, 'subscriptionIds' | 'names'>,
): Array<{ id: string; name: string; href: string }> {
  const ids = finding.subscriptionIds ?? [];
  const names = finding.names ?? [];
  return ids
    .filter((id) => typeof id === 'string' && id !== '')
    .map((id, i) => ({
      id,
      name: names[i] ?? id,
      href: `/subscriptions/${id}`,
    }));
}

// The rule behind each verdict, spelled out with the numbers the server itself
// applied. Driven entirely by `thresholds` — change a constant in Go and this
// copy follows, rather than the UI describing a rule that is no longer running.
//
// The two counts are interpolated as whole phrases (`{count} lần` /
// `{months} tháng`) rather than as bare numbers, because Vietnamese does not
// inflect and English does: the phrase keys carry their own `enOne`, so
// "1 lần" reads "1 time" and "6 tháng" reads "6 months" at the same time.
export function thresholdLines(
  thresholds: SubscriptionAuditThresholds,
  locale: Locale,
): string[] {
  const {
    quietMinAutoCharges,
    quietMinMonths,
    upcomingRenewalDays,
    priceRiseMinPercent,
    duplicateNormalized,
  } = thresholds;

  return [
    translate(
      locale,
      'Gói tự trừ tiền: chỉ gắn cờ gói đang hoạt động, có bật tự gia hạn và không phải gói trọn đời, ' +
        'khi đã tự trừ ít nhất {charges}, khoản tự trừ đầu tiên cách đây ít nhất ' +
        '{months}, và bạn chưa từng tự ghi khoản thanh toán nào cho gói đó.',
      {
        charges: translate(locale, '{count} lần', { count: quietMinAutoCharges }),
        months: translate(locale, '{months} tháng', {
          months: quietMinMonths,
          count: quietMinMonths,
        }),
      },
    ),
    translate(
      locale,
      'Tăng giá: báo mọi mức tăng giữa hai kỳ thanh toán liền kề; từ {percent}% trở lên ' +
        'mới được coi là đáng chú ý.',
      { percent: priceRiseMinPercent },
    ),
    translate(
      locale,
      'Trùng nhau: hai gói đang hoạt động trùng tên{normalized} hoặc cùng hãng và cùng loại.',
      {
        normalized: duplicateNormalized
          ? translate(locale, ' (bỏ dấu, không phân biệt hoa/thường)')
          : '',
      },
    ),
    translate(
      locale,
      'Cửa sổ còn hành động được trước khi bị trừ tiền: {days} ngày.',
      { days: upcomingRenewalDays, count: upcomingRenewalDays },
    ),
  ];
}

// How many findings the panel announces. Comes straight from `counts`, which the
// server computes over the same list — never recomputed from a filtered array.
export function findingCount(audit: Pick<SubscriptionAudit, 'counts'>): number {
  return audit.counts?.total ?? 0;
}
