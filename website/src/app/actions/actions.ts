'use server';

// Thin proxy actions for the "Việc cần xử lý" queue. Identity + parsing + the
// calls live here; every rule (what the default snooze is, the 1–365 window,
// whether the item is really the caller's own) lives in Go.
//
// Every message this file returns is a dictionary KEY, never a pre-translated
// sentence: the caller (`components/action-item-snooze.tsx`) renders it through
// the same translator as the rest of that screen, so an English page cannot end
// up with a Vietnamese toast because this action resolved a different language.
// Go's own `message` arrives already localised (`apiFetch` sends `?lang=`) and
// is passed through untouched.
//
// No `revalidatePath`: /actions and the `(app)` layout (which draws the sidebar
// badge) read the queue with `cache: 'no-store'`, so the caller's
// `router.refresh()` already re-renders both with fresh data — same reasoning as
// `actions/reminders.ts`.

import { api } from '@/lib/api';
import { isValidSnoozeDays } from '@/lib/action-queue';

export type ActionMutationResult =
  | {
      ok: true;
      message?: string;
      // Echoed back from `SnoozeResult` so the toast can name the date without a
      // second read: the server owns "now", the client only formats it.
      snoozedUntil?: string;
      days?: number;
    }
  | { ok: false; message: string };

// Snooze one item for `days`. Re-snoozing is valid and only moves the deadline
// (the Go side upserts on `(userId, itemKey)`).
export async function snoozeActionItem(
  itemKey: string,
  days: number,
): Promise<ActionMutationResult> {
  if (!itemKey) {
    return { ok: false, message: 'Thiếu mã việc cần xử lý' };
  }
  // Mirrors the server's range so an out-of-range value is caught before the
  // round trip — Go still validates and answers 400 with its own copy.
  if (!isValidSnoozeDays(days)) {
    return { ok: false, message: 'Số ngày hoãn phải trong khoảng 1–365' };
  }

  const res = await api.actions.snooze(itemKey, days);
  if (!res.ok) {
    return {
      ok: false,
      message: res.message ?? 'Không hoãn được việc này, thử lại sau nhé.',
    };
  }
  return {
    ok: true,
    message: 'Đã hoãn {days} ngày',
    snoozedUntil: res.data.snoozedUntil,
    days: res.data.days,
  };
}

// Un-snooze — the item returns to the queue. A 404 means the row was not
// actually snoozed any more; Go refuses to answer a silent 200 there, so the
// caller gets the server's Vietnamese message instead of a false success.
export async function unsnoozeActionItem(itemKey: string): Promise<ActionMutationResult> {
  if (!itemKey) {
    return { ok: false, message: 'Thiếu mã việc cần xử lý' };
  }

  const res = await api.actions.unsnooze(itemKey);
  if (!res.ok) {
    return {
      ok: false,
      message: res.message ?? 'Không bỏ hoãn được việc này, thử lại sau nhé.',
    };
  }
  return { ok: true, message: 'Đã đưa việc này trở lại hàng đợi' };
}
