// The shop's repair promise (migration 0030, FEATURE_RESEARCH_2026-11 §6.1
// wave 2). One component, used by the standalone `/claims` list and by the
// device-detail claim card, so the countdown and — more importantly — the
// mandatory attribution line cannot differ between the two surfaces.
//
// Deliberately NOT a link: on `/claims` this chip sits inside the row's
// `<Link>`, and a nested anchor is invalid. The policy URL is on the wire
// (`sourceUrl`) for a future "xem chính sách" action; today the chip prints the
// retailer + checked date, which is the legal-risk mitigation the research
// document asks for ("theo chính sách của <retailer>" + ngày).
//
// Server-safe: no hooks, no `'use client'`. The caller supplies `t` and `locale`
// from the RSC translator (page) or `useT()`/`useLocale()` (client card).

import { AlarmClock, CalendarClock, CircleAlert, CircleCheck } from 'lucide-react';
import type { RepairPromise } from '@/lib/api/claims';
import {
  repairPromiseIsStale,
  repairPromiseStateLabel,
} from '@/lib/claims';
import { formatDate } from '@/lib/format';
import type { Translator } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import { cn } from '@/lib/utils';

const STATE_TONE: Record<string, string> = {
  ON_TRACK: 'bg-emerald-soft text-emerald-ink',
  DUE_SOON: 'bg-amber-soft text-amber-ink',
  OVERDUE: 'bg-rose-soft text-rose-ink',
  MET: 'bg-emerald-soft text-emerald-ink',
  MISSED: 'bg-rose-soft text-rose-ink',
};

function StateIcon({ state }: { state: RepairPromise['state'] }) {
  if (state === 'MET' || state === 'ON_TRACK') {
    return <CircleCheck className="h-3.5 w-3.5" />;
  }
  if (state === 'OVERDUE' || state === 'MISSED') {
    return <CircleAlert className="h-3.5 w-3.5" />;
  }
  return <AlarmClock className="h-3.5 w-3.5" />;
}

export function RepairPromiseChip({
  promise,
  locale,
  t,
  className,
}: {
  promise: RepairPromise;
  locale: Locale;
  t: Translator;
  className?: string;
}) {
  const stale = repairPromiseIsStale(promise.checkedAt);
  const open = promise.state === 'ON_TRACK' ||
    promise.state === 'DUE_SOON' ||
    promise.state === 'OVERDUE';

  // Countdown copy. The state chip already says "overdue"/"due soon"; this line
  // gives the number the user can act on. For a closed claim the close date is
  // already printed by the row above, so the chip only states MET/MISSED.
  let countdown: string | null = null;
  if (open) {
    if (promise.daysLeft > 0) {
      countdown = t('Còn {count} ngày', { count: promise.daysLeft });
    } else if (promise.daysLeft === 0) {
      countdown = t('Đến hạn hôm nay');
    } else {
      countdown = t('Quá hạn {count} ngày', { count: Math.abs(promise.daysLeft) });
    }
  }

  return (
    <div
      className={cn(
        'mt-2 rounded-lg border border-border/70 bg-surface-2 px-3 py-2',
        stale && 'opacity-75',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-bold',
            STATE_TONE[promise.state] ?? 'bg-surface-3 text-ink-2',
          )}
        >
          <StateIcon state={promise.state} />
          {repairPromiseStateLabel(promise.state, locale)}
        </span>
        {countdown && (
          <span className="font-semibold text-ink">{countdown}</span>
        )}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          {t('Cam kết {days} ngày · hạn {due}', {
            days: promise.days,
            due: formatDate(promise.dueAt, locale),
          })}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('Theo chính sách {retailer} · kiểm tra {checked}', {
          retailer: promise.retailerName,
          checked: formatDate(promise.checkedAt, locale),
        })}
        {promise.note ? ` · ${promise.note}` : ''}
        {stale ? ` · ${t('Số liệu có thể đã cũ.')}` : ''}
      </p>
    </div>
  );
}
