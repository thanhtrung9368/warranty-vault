import Link from 'next/link';
import { FORECAST_MONTH_CHOICES } from '@/lib/forecast-rollup';
import { getI18n } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

/**
 * Window selector for the spending forecast — plain links, so the whole section
 * stays a server render (no client state, no form library). `?fm=` is the same
 * param the page reads; the forecast endpoint takes `months` 1–24 and the four
 * choices here are the useful ones.
 *
 * `year` is the raw `/stats` year param, carried through so picking a window does
 * not reset the rest of the page.
 */
export async function ForecastWindowPicker({
  months,
  year,
}: {
  months: number;
  year?: string;
}) {
  const { t } = await getI18n();
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t('Khoảng dự báo')}
    >
      {FORECAST_MONTH_CHOICES.map((m) => {
        const params = new URLSearchParams();
        if (year) params.set('year', year);
        params.set('fm', String(m));
        const active = m === months;
        return (
          <Link
            key={m}
            href={`/stats?${params.toString()}`}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-pill border-[1.5px] px-2.5 py-1 text-xs font-semibold transition-colors',
              active
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-surface-2 text-ink-2 hover:bg-surface-3',
            )}
          >
            {t('{months} tháng', { months: m, count: m })}
          </Link>
        );
      })}
    </div>
  );
}
