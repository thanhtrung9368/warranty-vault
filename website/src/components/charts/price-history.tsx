'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { enUS, vi } from 'date-fns/locale';
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

type Point = {
  recordedAt: string; // ISO string for SSR-safety
  price: number;
};

export function PriceHistoryChart({ data }: { data: Point[] }) {
  const t = useT();
  const locale = useLocale();

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('Chưa có dữ liệu giá. Cập nhật giá hiện tại để bắt đầu theo dõi.')}
      </p>
    );
  }
  // Recharts wants Date-formatted x labels. The pattern follows the language,
  // the same way `formatDate` does (`vi-VN` was hard-coded here before).
  const dateLocale = locale === 'vi' ? vi : enUS;
  const series = data.map((p) => ({
    label: format(new Date(p.recordedAt), 'dd/MM/yy', { locale: dateLocale }),
    price: p.price,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickFormatter={(v: number) => compactMoney(v, locale)}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={((v: number) => [formatVND(v, locale), t('Giá')]) as never}
        />
        <Line
          type="monotone"
          dataKey="price"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
