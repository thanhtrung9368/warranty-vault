import Link from 'next/link';
import { ShieldCheck, TrendingUp, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryIcon } from '@/components/category-icon';
import { MonthlyBar } from '@/components/charts/monthly-bar';
import { CategoryPie } from '@/components/charts/category-pie';
import { YearPicker } from '@/components/year-picker';
import { EmptyState } from '@/components/empty-state';
import {
  monthlySpend,
  spendByCategory,
  yearlySpend,
  topExpensive,
  activeAssetValue,
  getYearsWithData,
} from '@/lib/stats';
import { CATEGORY_LABELS, type Category } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const total = await prisma.device.count({ where: { userId: user.id } });
  if (total === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Thống kê</h1>
        <EmptyState description="Chưa có dữ liệu để thống kê. Thêm thiết bị trước nhé." />
      </div>
    );
  }

  const years = await getYearsWithData(user.id);
  const currentYear = new Date().getFullYear();
  const year = sp.year ? Number(sp.year) : currentYear;

  const [monthly, byCategory, yearTotal, top, asset] = await Promise.all([
    monthlySpend(user.id, 12),
    spendByCategory(user.id),
    yearlySpend(user.id, year),
    topExpensive(user.id, 5),
    activeAssetValue(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Thống kê</h1>
        <p className="text-sm text-muted-foreground">
          Tổng quan chi phí mua sắm và giá trị tài sản còn bảo hành.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase text-muted-foreground">Tổng chi {year}</p>
            <p className="mt-1 text-2xl font-bold">{formatVND(yearTotal.total)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{yearTotal.count} thiết bị</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Tài sản còn bảo hành</p>
              <p className="mt-1 text-2xl font-bold">{formatVND(asset.total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{asset.count} thiết bị</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Tổng số thiết bị</p>
              <p className="mt-1 text-2xl font-bold">{total}</p>
            </div>
            <div className="rounded-lg bg-primary/10 p-3 text-primary">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Chi phí 12 tháng gần nhất</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyBar data={monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phân bổ theo loại</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryPie data={byCategory} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Tổng chi theo năm</CardTitle>
            <YearPicker years={years} value={year} />
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-bold">{formatVND(yearTotal.total)}</span>
              <span className="pb-1 text-sm text-muted-foreground">
                ({yearTotal.count} thiết bị mua trong {year})
              </span>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              {byCategory
                .filter((c) => c.total > 0)
                .sort((a, b) => b.total - a.total)
                .map((c) => (
                  <li
                    key={c.category}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <CategoryIcon
                        category={c.category}
                        className="h-4 w-4 text-muted-foreground"
                      />
                      {c.label}
                    </span>
                    <span className="font-medium">{formatVND(c.total)}</span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-amber-500" />
              Top 5 thiết bị đắt nhất
            </CardTitle>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <ol className="space-y-2">
                {top.map((d, i) => (
                  <li key={d.id}>
                    <Link
                      href={`/devices/${d.id}`}
                      className="flex items-center gap-3 rounded-md p-2 hover:bg-accent"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-bold">
                        {i + 1}
                      </span>
                      <CategoryIcon
                        category={d.category}
                        className="h-4 w-4 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[d.category as Category] ?? d.category}
                          {d.brand ? ` • ${d.brand}` : ''} • {formatDate(d.purchaseDate)}
                        </p>
                      </div>
                      <span className="font-semibold">{formatVND(d.purchasePrice)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
