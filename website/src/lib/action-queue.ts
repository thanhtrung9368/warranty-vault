// Pure display logic for the "Việc cần xử lý" queue (openapi `ActionQueue`).
//
// The Go endpoint already returns everything user-facing (`title`, `detail`,
// `note`, Vietnamese) and already sorted (`severity` desc → `dueDate` asc →
// `kind`/`itemKey`). Nothing here re-words or re-sorts those rows: it only
// decides how they are grouped, which entity a row links to, and how a date or
// a snooze deadline reads in Vietnamese.
//
// Kept free of React/Next so it can be unit-tested without a backend.
//
// ── Language ──────────────────────────────────────────────────────────────
//
// The sentences this module builds (`dueDateNote`, `snoozeNote`, the entity
// name a row links to) are user-facing, so every one of them takes a
// `locale: Locale` and goes through `translate()` — same rule as `format.ts`,
// and required rather than defaulted so a missed call site is a compile error
// rather than Vietnamese text inside an English page (docs/I18N_PLAN.md §4.3).
//
// Two things are deliberately NOT translated here: `SEVERITY_SECTIONS`'
// `title`/`hint` and the `SNOOZE_CHOICES` labels. They stay Vietnamese because
// they are the dictionary keys, and the two components that render them
// (`app/(app)/actions/page.tsx`, `components/action-item-snooze.tsx`) pass them
// straight to `t(...)`. Re-wording them here would mean typing the Vietnamese
// sentence twice, which is the one thing this migration must not do.

import { differenceInCalendarDays } from 'date-fns';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
// Type-only import: a pure module must stay importable without the API client's
// session machinery (that is what lets the queue logic be unit-tested).
import type { ActionCounts, ActionItem, ActionSeverity } from '@/lib/api/actions';

// Snooze bounds, mirroring the Go constants (services.SnoozeDays*). They live
// here — the pure side — and `lib/api/actions.ts` re-exports them, so the UI
// choices and the request default cannot drift apart.
export const SNOOZE_DAYS_DEFAULT = 90;
export const SNOOZE_DAYS_MIN = 1;
export const SNOOZE_DAYS_MAX = 365;

export const SEVERITY_ORDER: readonly ActionSeverity[] = ['HIGH', 'MEDIUM', 'LOW'];

export type SeverityTone = 'rose' | 'amber' | 'zinc';

export type SeveritySection = {
  severity: ActionSeverity;
  // Section headings are web copy (the server ships machine codes only, plus
  // its own one-line meaning of HIGH/MEDIUM/LOW in openapi `ActionItem.severity`).
  title: string;
  hint: string;
  tone: SeverityTone;
};

// `hint` for HIGH is the server's own definition from openapi
// ("`HIGH` = mốc thời gian hoặc tiền sắp mất") rather than a new claim.
export const SEVERITY_SECTIONS: readonly SeveritySection[] = [
  { severity: 'HIGH', title: 'Ưu tiên cao', hint: 'Mốc thời gian hoặc tiền sắp mất', tone: 'rose' },
  { severity: 'MEDIUM', title: 'Ưu tiên vừa', hint: 'Nên xem lại', tone: 'amber' },
  { severity: 'LOW', title: 'Ưu tiên thấp', hint: 'Chưa gấp', tone: 'zinc' },
];

// The server only emits the three codes above. An unknown code from a newer
// server is bucketed as LOW so a row is never silently dropped from the page.
export function severityOf(item: Pick<ActionItem, 'severity'>): ActionSeverity {
  const s = item.severity;
  return (SEVERITY_ORDER as readonly string[]).includes(s) ? (s as ActionSeverity) : 'LOW';
}

// A row is snoozed iff it carries `snoozedUntil` — the field is absent on every
// actionable row, and only present at all when the caller asked
// `?snoozed=true`. Deliberately NOT derived from `counts`: `counts` always
// counts the actionable subset, even when snoozed rows are in `items`.
export function isSnoozed(item: Pick<ActionItem, 'snoozedUntil'>): boolean {
  return item.snoozedUntil != null && item.snoozedUntil !== '';
}

// Split the payload's rows into the queue and the "Đang hoãn" list, preserving
// the server's order in both.
export function splitQueue(items: readonly ActionItem[] | null | undefined): {
  active: ActionItem[];
  snoozed: ActionItem[];
} {
  const active: ActionItem[] = [];
  const snoozed: ActionItem[] = [];
  for (const item of items ?? []) {
    (isSnoozed(item) ? snoozed : active).push(item);
  }
  return { active, snoozed };
}

// Group the actionable rows by severity, in HIGH → MEDIUM → LOW order, keeping
// the server's within-group order. Empty groups are dropped so the page can map
// straight over the result (same shape as /reminders' bucket sections).
export function groupBySeverity(
  items: readonly ActionItem[] | null | undefined,
): Array<{ section: SeveritySection; items: ActionItem[] }> {
  return SEVERITY_SECTIONS.map((section) => ({
    section,
    items: (items ?? []).filter((i) => severityOf(i) === section.severity),
  })).filter((g) => g.items.length > 0);
}

// Badge count for the sidebar: always `counts.total`, which the server defines
// as the actionable subset regardless of the `snoozed` flag. Snoozed rows are
// reported separately by `snoozedCount` and must never be added in here.
export function badgeCount(counts: ActionCounts | null | undefined): number {
  return counts?.total ?? 0;
}

// Where a row links to, decided by `kind` (the stable code clients switch on).
// Kinds without an entity — none today, but the contract allows it — return
// null and the page renders a plain title instead of a dead link.
export function actionHref(item: Pick<ActionItem, 'kind'> & Partial<ActionItem>): string | null {
  switch (item.kind) {
    case 'WARRANTY_EXPIRED':
    case 'DEVICE_NO_WARRANTY':
    case 'DEVICE_STATUS_STALE':
    case 'DEVICE_MISSING_SERIAL':
    case 'DEVICE_MISSING_RECEIPT':
    case 'RETURN_WINDOW_CLOSING':
    case 'RETURN_WINDOW_UNKNOWN':
      return item.deviceId ? `/devices/${item.deviceId}` : null;
    case 'SUBSCRIPTION_RENEWING_NO_CANCEL_URL':
    case 'SUBSCRIPTION_PAID_NOT_ADVANCED':
      return item.subscriptionId ? `/subscriptions/${item.subscriptionId}` : null;
    case 'WISHLIST_TARGET_PASSED':
      return item.wishlistItemId ? `/wishlist/${item.wishlistItemId}` : null;
    default:
      // Forward compatibility: an unknown kind still links when the payload
      // happens to carry exactly one entity id.
      if (item.deviceId) return `/devices/${item.deviceId}`;
      if (item.subscriptionId) return `/subscriptions/${item.subscriptionId}`;
      if (item.wishlistItemId) return `/wishlist/${item.wishlistItemId}`;
      return null;
  }
}

// Vietnamese noun for the linked entity ("Thiết bị" / "Gói đăng ký" / "Món đang
// thèm"), used as the link's accessible label.
//
// It returns the Vietnamese NOUN rather than a translated one on purpose: the
// noun is a dictionary key, and the link also has to write the sentence around
// it ("Xem {entity}" / "View {entity}"), which only the render site can do —
// `t('Xem {entity}', { entity: t(entity) })`. Translating here would leave the
// caller holding an English noun with no way back to the key.
export function entityLabel(
  item: Pick<ActionItem, 'kind'> & Partial<ActionItem>,
): string | null {
  const href = actionHref(item);
  if (!href) return null;
  if (href.startsWith('/devices/')) return 'Thiết bị';
  if (href.startsWith('/subscriptions/')) return 'Gói đăng ký';
  if (href.startsWith('/wishlist/')) return 'Món đang thèm';
  return null;
}

// ---- Dates -------------------------------------------------------------------

// Whole-day distance from `now`, negative when the date already passed. Uses the
// same `new Date(string)` boundary handling as the rest of the web app
// (`lib/format.ts`), so a date never reads a day off from a neighbouring label.
export function daysUntil(date: string, now: Date = new Date()): number {
  return differenceInCalendarDays(new Date(date), now);
}

// Short Vietnamese phrase for a deadline, translated at the call site. Matches
// the server's day semantics for `ReturnWindow.daysLeft`: 0 means "today is the
// last day".
export function dueDateNote(date: string, locale: Locale, now: Date = new Date()): string {
  const days = daysUntil(date, now);
  if (days === 0) return translate(locale, 'hôm nay');
  if (days > 0) return translate(locale, 'còn {days} ngày', { days, count: days });
  const past = Math.abs(days);
  return translate(locale, 'đã qua {days} ngày', { days: past, count: past });
}

// Same idea for a snooze deadline, phrased as when the row comes back.
export function snoozeNote(snoozedUntil: string, locale: Locale, now: Date = new Date()): string {
  const days = daysUntil(snoozedUntil, now);
  if (days > 1) return translate(locale, 'Hiện lại sau {days} ngày', { days, count: days });
  if (days === 1) return translate(locale, 'Hiện lại ngày mai');
  if (days === 0) return translate(locale, 'Hiện lại hôm nay');
  return translate(locale, 'Đã tới hạn hiện lại');
}

// ---- Snooze choices ----------------------------------------------------------

export type SnoozeChoice = { days: number; label: string };

// A few sensible durations. 90 ngày is the server default (`SnoozeDaysDefault`)
// and is marked as such so the one-tap choice matches what an empty body would
// have done. Every value is inside the server's 1..365 window.
export const SNOOZE_CHOICES: readonly SnoozeChoice[] = [
  { days: 7, label: '1 tuần' },
  { days: 30, label: '1 tháng' },
  { days: SNOOZE_DAYS_DEFAULT, label: '3 tháng (mặc định)' },
  { days: 180, label: '6 tháng' },
  { days: SNOOZE_DAYS_MAX, label: '1 năm' },
];

// The choices are a client-side convenience; the server still owns the range.
export function isValidSnoozeDays(days: number): boolean {
  return Number.isInteger(days) && days >= SNOOZE_DAYS_MIN && days <= SNOOZE_DAYS_MAX;
}
