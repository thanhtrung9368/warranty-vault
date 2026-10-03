// Typed wrappers around the Go service's "Việc cần xử lý" endpoints:
//   GET    /v1/actions[?snoozed=true]
//   POST   /v1/actions/{itemKey}/snooze   body { days }
//   DELETE /v1/actions/{itemKey}/snooze
//
// Mirrors openapi `ActionQueue` / `ActionItem` / `SnoozeInput` / `SnoozeResult`
// (api/internal/services/actions.go). Everything user-facing inside the payload
// — `title`, `detail`, `note` — is Vietnamese copy produced by Go and rendered
// as-is; nothing here re-words it.
//
// Contract points that shape the UI:
//   - `snoozed=true` **only adds** rows (each carrying `snoozedUntil`). It never
//     removes a row and never changes `counts`.
//   - `counts` always counts the actionable subset, so it is the only correct
//     source for a badge. `snoozedCount` is the separate entry point for the
//     "Đang hoãn" list, whether or not those rows are in `items`.
//   - `itemKey` (`<KIND>:<entityId>`) is the stable identity used by the snooze
//     endpoints — pass it through verbatim (`:` is legal in a path segment).

import { apiFetch, type ApiResult } from './client';
import { SNOOZE_DAYS_DEFAULT } from '@/lib/action-queue';

// Machine codes — clients switch on these to decide links/buttons. The list is
// closed in openapi (`ActionItem.kind`), but an unknown code from a newer server
// must not crash a page: `unknown` is handled defensively in `lib/action-queue`.
export type ActionKind =
  | 'WARRANTY_EXPIRED'
  | 'DEVICE_NO_WARRANTY'
  | 'DEVICE_STATUS_STALE'
  | 'DEVICE_MISSING_SERIAL'
  | 'DEVICE_MISSING_RECEIPT'
  | 'RETURN_WINDOW_CLOSING'
  | 'RETURN_WINDOW_UNKNOWN'
  | 'SUBSCRIPTION_RENEWING_NO_CANCEL_URL'
  | 'SUBSCRIPTION_PAID_NOT_ADVANCED'
  | 'WISHLIST_TARGET_PASSED';

export type ActionSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

// Wire shape from services.ActionItem. `dueDate` / `amountVnd` / `snoozedUntil`
// are `omitempty` on the Go side, so they are genuinely absent (not null) when
// the item has none — hence optional + nullable.
export type ActionItem = {
  itemKey: string;
  kind: ActionKind | string;
  severity: ActionSeverity | string;
  title: string;
  detail: string;
  deviceId?: string | null;
  warrantyId?: string | null;
  subscriptionId?: string | null;
  wishlistItemId?: string | null;
  dueDate?: string | null;
  amountVnd?: number | null;
  snoozedUntil?: string | null;
};

// Shared with the subscription audit (`openapi ActionCounts`).
export type ActionCounts = {
  total: number;
  high: number;
  medium: number;
  low: number;
};

export type ActionQueue = {
  generatedAt: string;
  items: ActionItem[];
  counts: ActionCounts;
  snoozedCount: number;
  note: string;
};

export type SnoozeResult = {
  itemKey: string;
  snoozedUntil: string;
  // The applied value — mirrors the server default (90) when `days` was omitted.
  days: number;
};

// Snooze bounds, mirroring the Go constants (services.SnoozeDays*). Defined once
// in the pure `lib/action-queue` module (so the queue's duration choices and this
// default cannot drift) and re-exported here for callers that only talk to the API.
export { SNOOZE_DAYS_DEFAULT, SNOOZE_DAYS_MIN, SNOOZE_DAYS_MAX } from '@/lib/action-queue';

export type ActionListOptions = {
  // Ask for the snoozed rows too. Only ever sent when true: the server default
  // is already the false branch, so an explicit `snoozed=false` would be noise.
  snoozed?: boolean;
};

export async function list(options?: ActionListOptions): Promise<ApiResult<ActionQueue>> {
  const qs = options?.snoozed ? '?snoozed=true' : '';
  return apiFetch<ActionQueue>('GET', `/v1/actions${qs}`);
}

// Snooze an item for `days` (1..365; the server falls back to 90 when the body
// is empty or zero). Snoozing again just moves the date.
export async function snooze(
  itemKey: string,
  days: number = SNOOZE_DAYS_DEFAULT,
): Promise<ApiResult<SnoozeResult>> {
  return apiFetch<SnoozeResult>(
    'POST',
    `/v1/actions/${encodeURIComponent(itemKey)}/snooze`,
    { days },
  );
}

// Un-snooze — the item returns to the queue immediately. 404 when it is not
// currently snoozed (deliberately not a silent 200).
export async function unsnooze(itemKey: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>(
    'DELETE',
    `/v1/actions/${encodeURIComponent(itemKey)}/snooze`,
  );
}
