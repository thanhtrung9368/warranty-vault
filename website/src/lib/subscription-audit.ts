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
): string | null {
  switch (finding.kind) {
    case 'PRICE_INCREASED':
      return finding.material === false ? 'Mức tăng nhỏ' : 'Đáng chú ý';
    case 'DUPLICATE':
      if (finding.reason === 'SAME_NAME') return 'Trùng tên';
      if (finding.reason === 'SAME_BRAND_CATEGORY') return 'Cùng hãng, cùng loại';
      return 'Có thể trùng nhau';
    case 'QUIET_AUTO_RENEW':
      return 'Chỉ tư vấn';
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
export function thresholdLines(thresholds: SubscriptionAuditThresholds): string[] {
  const {
    quietMinAutoCharges,
    quietMinMonths,
    upcomingRenewalDays,
    priceRiseMinPercent,
    duplicateNormalized,
  } = thresholds;

  return [
    `Gói tự trừ tiền: chỉ gắn cờ gói đang hoạt động, có bật tự gia hạn và không phải gói trọn đời, ` +
      `khi đã tự trừ ít nhất ${quietMinAutoCharges} lần, khoản tự trừ đầu tiên cách đây ít nhất ` +
      `${quietMinMonths} tháng, và bạn chưa từng tự ghi khoản thanh toán nào cho gói đó.`,
    `Tăng giá: báo mọi mức tăng giữa hai kỳ thanh toán liền kề; từ ${priceRiseMinPercent}% trở lên ` +
      `mới được coi là đáng chú ý.`,
    `Trùng nhau: hai gói đang hoạt động trùng tên` +
      (duplicateNormalized ? ' (bỏ dấu, không phân biệt hoa/thường)' : '') +
      ` hoặc cùng hãng và cùng loại.`,
    `Cửa sổ còn hành động được trước khi bị trừ tiền: ${upcomingRenewalDays} ngày.`,
  ];
}

// How many findings the panel announces. Comes straight from `counts`, which the
// server computes over the same list — never recomputed from a filtered array.
export function findingCount(audit: Pick<SubscriptionAudit, 'counts'>): number {
  return audit.counts?.total ?? 0;
}
