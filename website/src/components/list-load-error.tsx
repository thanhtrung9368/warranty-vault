'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

/**
 * A failed list read, rendered as a failure.
 *
 * Four pages used to coerce a failed read to `[]` and then render their empty
 * state — "Chưa có thiết bị nào", "Không có nhắc nhở nào, ngon!" — which tells
 * a user who has data that their account is empty. This is the same banner
 * `/claims` and `/inbox` already use (`role="alert"`, rose background), with a
 * retry that re-requests the CURRENT route: `router.refresh()` keeps the
 * filters in the URL and re-runs the force-dynamic render, so the retry cannot
 * silently navigate the user somewhere else.
 *
 * A page shows this above the rows it did load. A partial read is a warning,
 * not a page failure — `app/(app)/error.tsx` is for the hard case where the
 * page itself cannot render at all.
 */
export function ListLoadError({ message }: { message: string }) {
  const t = useT();
  const router = useRouter();

  return (
    <p
      role="alert"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-rose-ink/20 bg-rose-soft px-4 py-3 text-sm font-semibold text-rose-ink"
    >
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-rose-ink/25 bg-card px-3 py-1 text-xs font-bold text-rose-ink transition-opacity hover:opacity-80"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        {t('Thử lại')}
      </button>
    </p>
  );
}
