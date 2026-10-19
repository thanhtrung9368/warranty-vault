// Badging API glue for the installed PWA.
//
// The web cannot render a home-screen widget. The closest honest surface is
// the number drawn on the installed app's icon: `navigator.setAppBadge(n)`
// draws it and `navigator.clearAppBadge()` removes it. Chromium (desktop and
// Android) implements both; Safari and Firefox do not, so every call is
// feature-detected and every failure is swallowed. A badge is an enhancement —
// it must never break a page or produce an unhandled rejection.
//
// This module never fetches. `(app)/layout.tsx` already calls
// `GET /v1/reminders?withinDays=30` for the sidebar count; the badge is fed
// from that same result, so opening a page costs no extra request.

/** The horizon of the reminder read that feeds the badge. */
export const APP_BADGE_WITHIN_DAYS = 30;

/** The slice of `ReminderRow` the selector needs. */
export type AppBadgeReminder = {
  /**
   * Only the widened (`includeDismissed=true`) feed carries this. The default
   * feed excludes hidden rows server-side, but filtering here means a caller
   * cannot accidentally count a hidden reminder.
   */
  isDismissed?: boolean;
};

/**
 * How many deadlines the badge should show.
 *
 * The caller passes the already-filtered 30-day feed (the same rows the Go
 * endpoint returns: upcoming end dates on ACTIVE devices, no dismissed rows).
 * Re-applying a date window here would use the browser's clock and timezone,
 * which can drop a deadline the server put exactly on the boundary; the
 * server's horizon is the authority. `null`/`undefined` (a failed read) is 0.
 */
export function dueBadgeCount(
  reminders: ReadonlyArray<AppBadgeReminder> | null | undefined,
): number {
  let count = 0;
  for (const reminder of reminders ?? []) {
    if (reminder.isDismissed !== true) count += 1;
  }
  return count;
}

/**
 * The two Badging API methods, as a structural type.
 *
 * Declared locally because `lib.dom.d.ts` in the pinned TypeScript version does
 * not carry them; keeping it structural also makes the tests pass a plain
 * object instead of a browser.
 */
export type AppBadgeNavigator = {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Set the icon badge for `count`, clearing it for zero (or a bad value).
 *
 * Returns whether a Badging API call was attempted, which is mostly useful to
 * tests; callers ignore it. Never throws — a missing method (Safari/Firefox),
 * a synchronous throw, or a rejected promise all degrade to "no badge".
 *
 * Zero ALWAYS goes through `clearAppBadge()` when it exists, per the spec and
 * because a stuck "1 due" badge is worse than no badge. `setAppBadge(0)` is
 * only a fallback for an implementation that forgot to ship `clearAppBadge`.
 */
export function applyAppBadge(
  navigator: AppBadgeNavigator | null | undefined,
  count: number,
): boolean {
  const value = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  try {
    if (value > 0) {
      if (typeof navigator?.setAppBadge !== 'function') return false;
      void Promise.resolve(navigator.setAppBadge(value)).catch(() => undefined);
      return true;
    }

    if (typeof navigator?.clearAppBadge === 'function') {
      void Promise.resolve(navigator.clearAppBadge()).catch(() => undefined);
      return true;
    }

    // Some early Chromium builds exposed only `setAppBadge`; 0 is the value
    // that clears it. Kept as a fallback, not the normal path.
    if (typeof navigator?.setAppBadge === 'function') {
      void Promise.resolve(navigator.setAppBadge(0)).catch(() => undefined);
      return true;
    }
  } catch {
    // A property getter/method that throws still means "not supported here".
  }
  return false;
}
