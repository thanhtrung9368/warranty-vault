export const WISHLIST_PRIORITIES = ['MUST', 'WANT', 'MAYBE'] as const;
export type WishlistPriority = (typeof WISHLIST_PRIORITIES)[number];

export const WISHLIST_PRIORITY_LABELS: Record<WishlistPriority, string> = {
  MUST: 'Phải mua',
  WANT: 'Muốn',
  MAYBE: 'Cân nhắc',
};

export const WISHLIST_PRIORITY_COLORS: Record<WishlistPriority, string> = {
  MUST: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  WANT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  MAYBE: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export const WISHLIST_PRIORITY_RANK: Record<WishlistPriority, number> = {
  MUST: 0,
  WANT: 1,
  MAYBE: 2,
};

export const WISHLIST_STATUSES = [
  'WATCHING',
  'DECIDED',
  'SKIPPED',
  'PURCHASED',
] as const;
export type WishlistStatus = (typeof WISHLIST_STATUSES)[number];

export const WISHLIST_STATUS_LABELS: Record<WishlistStatus, string> = {
  WATCHING: 'Đang theo dõi',
  DECIDED: 'Quyết mua',
  SKIPPED: 'Bỏ qua',
  PURCHASED: 'Đã mua',
};

export const WISHLIST_STATUS_COLORS: Record<WishlistStatus, string> = {
  WATCHING: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  DECIDED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  SKIPPED: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  PURCHASED: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

export const WISHLIST_STATUS_BADGE_VARIANT: Record<
  WishlistStatus,
  'info' | 'success' | 'secondary' | 'default'
> = {
  WATCHING: 'info',
  DECIDED: 'success',
  SKIPPED: 'secondary',
  // No "violet" variant in the typed map — fall back to default primary
  // (callsite keeps the existing raw class for the violet purchased look).
  PURCHASED: 'default',
};

// Statuses considered "active" — counted in dashboard totals, surfaced in cron.
export const WISHLIST_ACTIVE_STATUSES: WishlistStatus[] = ['WATCHING', 'DECIDED'];
