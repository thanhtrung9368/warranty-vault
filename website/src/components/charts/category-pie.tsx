'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatVND } from '@/lib/format';

// Palette pulled from the design tokens — slice colors map 1:1 to the
// `.tint-*` helpers used in legend chips below. Order matches the order
// categories appear in the data array.
const SLICE_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--emerald))',
  'hsl(var(--amber))',
  'hsl(var(--rose))',
  'hsl(var(--violet))',
  'hsl(var(--sky))',
  'hsl(var(--primary-2))',
];

const LEGEND_TINTS = [
  'tint-primary',
  'tint-emerald',
  'tint-amber',
  'tint-rose',
  'tint-violet',
  'tint-sky',
  'tint-zinc',
];

export function CategoryPie({
  data,
}: {
  data: { label: string; total: number; count: number }[];
}) {
  const filtered = data.filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
  if (filtered.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Chưa có dữ liệu chi phí.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="w-[220px] shrink-0">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={filtered}
              dataKey="total"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
              stroke="hsl(var(--surface))"
              strokeWidth={3}
            >
              {filtered.map((_, i) => (
                <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1.5px solid hsl(var(--border))',
                borderRadius: 12,
                fontSize: 12,
                boxShadow: 'var(--shadow-2)',
              }}
              formatter={
                ((v: number, _n: unknown, item: { payload: { count: number; label: string } }) => [
                  `${formatVND(v)} (${item.payload.count} món)`,
                  item.payload.label,
                ]) as never
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-[180px] flex-1 flex-col gap-1.5">
        {filtered.map((c, i) => (
          <li key={c.label} className="flex items-center gap-2 text-sm">
            <span
              className={`inline-block h-3 w-3 shrink-0 rounded-sm ${LEGEND_TINTS[i % LEGEND_TINTS.length]}`}
              style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
              aria-hidden
            />
            <span className="flex-1 truncate">{c.label}</span>
            <span className="font-semibold tabular-nums text-ink-2">{formatVND(c.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
