// Typed wrappers around the Go service's /v1/reminders + /v1/warranties/{id}/reminder
// endpoints.
//
// `GET /v1/reminders` returns warranties whose endDate falls within
// [today, today + withinDays] for ACTIVE devices, excluding any with a
// dismissed `Reminder` row. The shape mirrors
// api/internal/services/reminders.go::ReminderRow — Warranty fields embedded
// + a small device projection.
//
// `?includeDismissed=true` is the opt-in widening of that feed: it also
// returns the warranties the user has hidden, each flagged `isDismissed: true`.
// It is the light read behind the “Đã ẩn” section on /reminders — the page
// used to parse the whole backup export (`GET /v1/backup/export`) for those
// rows. The parameter defaults to false server-side, so callers that don't ask
// for it (e.g. the dashboard badge) are unaffected.
//
// Dismiss / restore use the same warranty-scoped endpoint — POST to dismiss,
// DELETE to restore.

import { apiFetch, type ApiResult } from './client';
import type { Warranty } from './devices';

// Wire shape from services.ReminderRow.
export type ReminderRow = Warranty & {
  // Only carried by the widened feed (`includeDismissed: true`): true marks a
  // warranty the user has dismissed. Optional because the default feed never
  // contains dismissed rows and may omit the field entirely.
  isDismissed?: boolean;
  device: {
    id: string;
    name: string;
    category: string;
    // Device status. Not part of the original device projection; when the
    // server omits it callers read the device as ACTIVE — the same default the
    // previous backup-based rollup used for a device without `status`.
    status?: string;
  };
};

// Default lookahead horizon. The Go server accepts 1..365 and defaults to 30
// when omitted; we surface the same default here for callers that care.
export const DEFAULT_WITHIN_DAYS = 30;

export type ReminderListOptions = {
  // Ask the feed to include dismissed rows as well (each flagged with
  // `isDismissed`). Defaults to false on the server, so we only send the
  // parameter when a caller explicitly opts in — an explicit
  // `includeDismissed=false` would just be noise on the wire.
  includeDismissed?: boolean;
};

// Co-located querystring builder (same idea as `devices.ts::toQueryString`) so
// callers and tests share one place where UI-level sentinels get dropped.
function toQueryString(withinDays?: number, options?: ReminderListOptions): string {
  const params = new URLSearchParams();
  if (withinDays) params.set('withinDays', String(withinDays));
  if (options?.includeDismissed) params.set('includeDismissed', 'true');
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function list(
  withinDays?: number,
  options?: ReminderListOptions,
): Promise<ApiResult<ReminderRow[]>> {
  const res = await apiFetch<{ reminders: ReminderRow[] }>(
    'GET',
    `/v1/reminders${toQueryString(withinDays, options)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.reminders ?? [] };
}

// Mark the warranty's reminder as dismissed (creates the Reminder row /
// flips isDismissed=true server-side).
export async function dismiss(warrantyId: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>(
    'POST',
    `/v1/warranties/${encodeURIComponent(warrantyId)}/reminder`,
  );
}

// Inverse of dismiss — flips isDismissed=false (or removes the row).
export async function restore(warrantyId: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>(
    'DELETE',
    `/v1/warranties/${encodeURIComponent(warrantyId)}/reminder`,
  );
}
