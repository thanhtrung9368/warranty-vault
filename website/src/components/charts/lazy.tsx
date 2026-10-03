'use client';

// Client-only lazy wrappers for the recharts-backed charts.
//
// recharts is ~100KB and only ever renders in the browser (it relies on
// ResponsiveContainer measuring the DOM). The chart files themselves are
// `'use client'`, but `next/dynamic` with `ssr: false` can only be called
// from a Client Component — so these thin wrappers exist purely to host the
// `dynamic()` calls and let RSC pages (`stats`, `subscriptions/[id]`) import
// them like any other component. The recharts chunk now loads on demand
// instead of shipping in the page's initial JS.

import dynamic from 'next/dynamic';

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="flex w-full animate-pulse items-end justify-center rounded-xl bg-surface-2"
      style={{ height }}
      aria-hidden
    >
      <span className="sr-only">Đang tải biểu đồ…</span>
    </div>
  );
}

export const MonthlyBar = dynamic(
  () => import('./monthly-bar').then((m) => m.MonthlyBar),
  { ssr: false, loading: () => <ChartSkeleton height={280} /> },
);

export const CategoryPie = dynamic(
  () => import('./category-pie').then((m) => m.CategoryPie),
  { ssr: false, loading: () => <ChartSkeleton height={220} /> },
);

export const PriceHistoryChart = dynamic(
  () => import('./price-history').then((m) => m.PriceHistoryChart),
  { ssr: false, loading: () => <ChartSkeleton height={220} /> },
);

// Spending forecast (`/stats`). Same on-demand recharts chunk as the others;
// stacked because the auto-charged / self-renewed split is the point of the
// chart, not a detail.
export const ForecastBar = dynamic(
  () => import('./forecast-bar').then((m) => m.ForecastBar),
  { ssr: false, loading: () => <ChartSkeleton height={280} /> },
);
