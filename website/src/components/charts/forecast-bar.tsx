'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatVND } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locale';

// Axis tick labels are user-facing copy, so the unit suffix follows the
// language: "1tr" / "1.5tr" (triệu) in Vietnamese, "1M" / "1.5M" (million) in
// English. Duplicated in the three chart files on purpose — the alternative was
// a new module, and this change is scoped to converting existing files.
function compactMoney(v: number, locale: Locale): string {
  if (v >= 1_000_000) {
    const millions = v / 1_000_000;
    const rounded = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
    return `${rounded}${locale === 'vi' ? 'tr' : 'M'}`;
  }
  if (v >= 1000) return `${v / 1000}k`;
  return `${v}`;
}

// Month-by-month forecast of SCHEDULED subscription charges, stacked so the two
// kinds of money stay visually apart:
//   * `auto`      — will be charged automatically (autoRenew = true);
//   * `selfRenew` — the package exists but the user must renew it by hand.
//
// The chart deliberately shows nothing else. Warranty-expiry and wishlist money
// are references, not commitments (see the API `note`), so folding them into this
// bar would present a possible spend as a scheduled one — the exact lie the
// forecast section is built to avoid.
export function ForecastBar({
  data,
}: {
  data: { month: string; label: string; total: number; auto: number; selfRenew: number }[];
}) {
  const t = useT();
  const locale = useLocale();

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="month"
          stroke="hsl(var(--muted))"
          fontSize={11}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
        />
        <YAxis
          stroke="hsl(var(--muted))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => compactMoney(v, locale)}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--primary-soft))', opacity: 0.5 }}
          contentStyle={{
            background: 'hsl(var(--popover))',
            border: '1.5px solid hsl(var(--border))',
            borderRadius: 12,
            fontSize: 12,
            boxShadow: 'var(--shadow-2)',
          }}
          formatter={((v: number, name: string) => [formatVND(v, locale), name]) as never}
          labelFormatter={((label: string, payload: { payload?: { label?: string } }[]) =>
            payload?.[0]?.payload?.label ?? label) as never}
          labelStyle={{ color: 'hsl(var(--ink))', fontWeight: 700 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* The two series names are the same sentences the panel's money blocks
            use, so the legend cannot drift from the labels above it. */}
        <Bar
          dataKey="auto"
          name={t('Tự động trừ')}
          stackId="charges"
          fill="hsl(var(--primary))"
        />
        <Bar
          dataKey="selfRenew"
          name={t('Bạn phải tự gia hạn')}
          stackId="charges"
          fill="hsl(var(--warning))"
          radius={[8, 8, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
