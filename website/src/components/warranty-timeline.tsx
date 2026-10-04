'use client';

// Client component: it renders the translated warranty state label and a locale
// -aware date, both of which need the locale from the React provider. Its only
// caller (`components/warranty-list.tsx`) is a client component too, so nothing
// about the call site changes.

import { differenceInDays } from 'date-fns';
import { formatDate, warrantyState } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export function WarrantyTimeline({
  purchaseDate,
  warrantyEndDate,
}: {
  purchaseDate: Date | string;
  warrantyEndDate: Date | string;
}) {
  const t = useT();
  const locale = useLocale();
  const start = typeof purchaseDate === 'string' ? new Date(purchaseDate) : purchaseDate;
  const end = typeof warrantyEndDate === 'string' ? new Date(warrantyEndDate) : warrantyEndDate;
  const total = Math.max(1, differenceInDays(end, start));
  const elapsed = Math.max(0, Math.min(total, differenceInDays(new Date(), start)));
  const pct = Math.min(100, Math.round((elapsed / total) * 100));
  const state = warrantyState(end, locale);

  // Map the warranty tone onto the design system soft+ink colors. We render
  // the bar with a custom div so we get rounded pill caps that match the
  // Duolingo-style aesthetic, instead of the default Progress component.
  const fill =
    state.tone === 'expired'
      ? 'bg-zinc-soft'
      : state.tone === 'danger'
        ? 'bg-rose-soft'
        : state.tone === 'warn'
          ? 'bg-amber-soft'
          : 'bg-emerald-soft';
  const fillStrong =
    state.tone === 'expired'
      ? 'bg-zinc-400'
      : state.tone === 'danger'
        ? 'bg-rose-500'
        : state.tone === 'warn'
          ? 'bg-amber-500'
          : 'bg-emerald-500';

  return (
    <div className="space-y-2">
      <div className={cn('h-2.5 w-full overflow-hidden rounded-pill', fill)}>
        <div
          className={cn('h-full rounded-pill transition-all', fillStrong)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {t('Mua')}: {formatDate(start, locale)}
        </span>
        <span className="font-bold text-ink">{state.label}</span>
        <span className="text-muted-foreground">
          {t('Hết')}: {formatDate(end, locale)}
        </span>
      </div>
    </div>
  );
}
