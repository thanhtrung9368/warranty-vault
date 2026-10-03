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
          tickFormatter={(v: number) =>
            v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}tr` : v >= 1000 ? `${v / 1000}k` : `${v}`
          }
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
          formatter={((v: number, name: string) => [formatVND(v), name]) as never}
          labelFormatter={((label: string, payload: { payload?: { label?: string } }[]) =>
            payload?.[0]?.payload?.label ?? label) as never}
          labelStyle={{ color: 'hsl(var(--ink))', fontWeight: 700 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="auto"
          name="Tự động trừ"
          stackId="charges"
          fill="hsl(var(--primary))"
        />
        <Bar
          dataKey="selfRenew"
          name="Bạn phải tự gia hạn"
          stackId="charges"
          fill="hsl(var(--warning))"
          radius={[8, 8, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
