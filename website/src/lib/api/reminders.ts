// Typed wrappers around the Go service's /v1/reminders + /v1/warranties/{id}/reminder
// endpoints.
//
// `GET /v1/reminders` returns warranties whose endDate falls within
// [today, today + withinDays] for ACTIVE devices, excluding any with a
// dismissed `Reminder` row. The shape mirrors
// api/internal/services/reminders.go::ReminderRow — Warranty fields embedded
// + a small device projection.
//
// Dismiss / restore use the same warranty-scoped endpoint — POST to dismiss,
// DELETE to restore.

import { apiFetch, type ApiResult } from './client';
import type { Warranty } from './devices';

// Wire shape from services.ReminderRow.
export type ReminderRow = Warranty & {
  device: {
    id: string;
    name: string;
    category: string;
  };
};

// Default lookahead horizon. The Go server accepts 1..365 and defaults to 30
// when omitted; we surface the same default here for callers that care.
export const DEFAULT_WITHIN_DAYS = 30;

export async function list(withinDays?: number): Promise<ApiResult<ReminderRow[]>> {
  const qs = withinDays ? `?withinDays=${encodeURIComponent(String(withinDays))}` : '';
  const res = await apiFetch<{ reminders: ReminderRow[] }>('GET', `/v1/reminders${qs}`);
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
