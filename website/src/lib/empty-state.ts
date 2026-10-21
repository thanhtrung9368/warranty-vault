// Empty-state copy is a DECISION, not a sentence.
//
// A screen that says "Nothing is waiting" or "No reminders — nice!" is making a
// claim: "we looked at your data and nothing needs you". That claim is true only
// when the account actually has devices. For an account with no devices the app
// looked at nothing, and the same green tick reads as reassurance it has not
// earned. `EmptyReason` is the two cases, and this module is the single place
// that maps each one to copy + a CTA.
//
// The strings are VIETNAMESE CATALOG KEYS (the app's convention — see
// `lib/i18n/catalog.ts`), not rendered sentences. `EmptyState` translates them
// at render time, and `__tests__/empty-state.test.ts` translates every one of
// them through the real catalog so an unregistered key cannot silently render
// Vietnamese to an English reader.
//
// A CTA is part of every set. The old component allowed `cta={false}`, and the
// two screens that needed it most (`/reminders`, `/actions`) used it: an empty
// queue with no way forward is a dead end. A caller may still suppress the CTA
// for a FILTERED list ("no rows match this filter"), where "add a device" would
// be the wrong action — that is a different state, not this one.

export type EmptyReason = 'nothing-due' | 'no-data';

export type EmptyStateCopy = {
  /** Vietnamese catalog key for the heading. */
  title: string;
  /** Vietnamese catalog key for the one-sentence explanation. */
  description: string;
  ctaHref: string;
  /** Vietnamese catalog key for the button label. */
  ctaLabel: string;
};

export const EMPTY_STATE_COPY: Record<EmptyReason, EmptyStateCopy> = {
  // Genuine "we looked at data you entered, nothing needs you": the reassuring
  // case. The CTA is a way to review what is being tracked, not a nudge to add
  // something that already exists.
  'nothing-due': {
    title: 'Không có gì đang chờ',
    description:
      'Không có gì cần bạn quyết lúc này. Việc mới sẽ xuất hiện ở đây khi dữ liệu đổi.',
    ctaHref: '/devices',
    ctaLabel: 'Xem danh sách thiết bị',
  },
  // The cold case: the app has nothing to reason about, so it says that instead
  // of congratulating. The CTA is the first step of the product's loop.
  'no-data': {
    title: 'Chưa có thiết bị nào',
    description: 'Thêm một thiết bị là mục này tự đầy.',
    ctaHref: '/devices/new',
    ctaLabel: 'Thêm thiết bị',
  },
};

/**
 * The reason that follows from "does this account have any device at all?".
 *
 * Note this is NOT `stats.total === 0`: an account whose only device is SOLD
 * has data, so it is not the cold case — but it also is not "covered", which is
 * why the dashboard still refuses the success copy there.
 */
export function emptyReasonFor(hasDevices: boolean): EmptyReason {
  return hasDevices ? 'nothing-due' : 'no-data';
}

/** Copy set for a reason; anything unexpected falls back to `nothing-due`. */
export function emptyStateCopy(reason: EmptyReason | null | undefined): EmptyStateCopy {
  return EMPTY_STATE_COPY[reason === 'no-data' ? 'no-data' : 'nothing-due'];
}
