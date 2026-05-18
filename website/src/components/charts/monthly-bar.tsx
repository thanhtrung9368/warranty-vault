'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatVND } from '@/lib/format';

export function MonthlyBar({ data }: { data: { month: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 4"
          stroke="hsl(var(--border))"
          vertical={false}
        />
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
          formatter={((v: number) => [formatVND(v), 'Chi phí']) as never}
          labelStyle={{ color: 'hsl(var(--ink))', fontWeight: 700 }}
        />
        <Bar
          dataKey="total"
          fill="hsl(var(--primary))"
          radius={[8, 8, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
