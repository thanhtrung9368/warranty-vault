import Link from 'next/link';
import { Plus, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState } from '@/components/empty-state';
import { SubscriptionFilterBar } from '@/components/subscription-filter-bar';
import {
  listSubscriptions,
  subscriptionTotals,
  type SubscriptionFilter,
} from '@/lib/subscriptions';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/app/actions/catalog';
import { categoryLabel } from '@/lib/types';
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_COLORS,
  monthlyEquivalent,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';
import { differenceInDays } from 'date-fns';

export const dynamic = 'force-dynamic';

function renewalLabel(date: Date, cycle: string): { text: string; tone: string } {
  if (cycle === 'LIFETIME') return { text: 'Lifetime', tone: 'text-muted-foreground' };
  const days = differenceInDays(date, new Date());
  if (days < 0)
    return { text: `Quá hạn ${Math.abs(days)} ngày`, tone: 'text-red-600' };
  if (days === 0) return { text: 'Hôm nay', tone: 'text-amber-600 font-semibold' };
  if (days <= 3) return { text: `Còn ${days} ngày`, tone: 'text-red-600' };
  if (days <= 7) return { text: `Còn ${days} ngày`, tone: 'text-amber-600' };
  if (days <= 30) return { text: `Còn ${days} ngày`, tone: 'text-foreground' };
  return { text: formatDate(date), tone: 'text-muted-foreground' };
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    billingCycle?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter: SubscriptionFilter = {
    q: sp.q,
    category: sp.category,
    status: sp.status,
    billingCycle: sp.billingCycle,
    sort: (sp.sort as SubscriptionFilter['sort']) ?? 'renewal',
    dir: (sp.dir as 'asc' | 'desc') ?? 'asc',
  };
  const [subs, categories, totals] = await Promise.all([
    listSubscriptions(user.id, filter),
    getCategories(),
    subscriptionTotals(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Đăng ký</h1>
          <p className="text-sm text-muted-foreground">
            Hiển thị {subs.length} gói
            {filter.q || filter.category || filter.billingCycle ? ' (đã lọc)' : ''}
          </p>
        </div>
        <Button asChild>
          <Link href="/subscriptions/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm gói
          </Link>
        </Button>
      </div>

      {totals.count > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Mỗi tháng</p>
            <p className="mt-1 text-2xl font-bold">{formatVND(totals.monthly)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              ~ {formatVND(totals.yearly)} / năm
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Đang hoạt động</p>
            <p className="mt-1 text-2xl font-bold">{totals.count}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Sắp gia hạn</p>
            {totals.upcoming.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Chưa có gói nào sắp charge</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {totals.upcoming.slice(0, 3).map((u) => {
                  const { text, tone } = renewalLabel(u.renewalDate, u.billingCycle);
                  return (
                    <li key={u.id} className="truncate">
                      <Link href={`/subscriptions/${u.id}`} className="hover:underline">
                        {u.name}
                      </Link>{' '}
                      <span className={cn('text-xs', tone)}>{text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <SubscriptionFilterBar categories={categories} />

      {subs.length === 0 ? (
        <EmptyState
          title="Chưa có gói đăng ký nào"
          description={
            filter.q || filter.category
              ? 'Không tìm thấy gói phù hợp với bộ lọc.'
              : 'Note lại các gói phần mềm/dịch vụ — Apple One, ChatGPT, Spotify, hosting...'
          }
          cta={false}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gói</TableHead>
                <TableHead className="hidden md:table-cell">Plan</TableHead>
                <TableHead>Giá / chu kỳ</TableHead>
                <TableHead className="hidden lg:table-cell">~ /tháng</TableHead>
                <TableHead>Gia hạn</TableHead>
                <TableHead className="hidden sm:table-cell">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => {
                const monthly = monthlyEquivalent(
                  s.price,
                  s.billingCycle as BillingCycle,
                  s.intervalDays,
                );
                const { text: rText, tone: rTone } = renewalLabel(
                  s.renewalDate,
                  s.billingCycle,
                );
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/subscriptions/${s.id}`}
                        className="flex items-start gap-3"
                      >
                        <div className="rounded-md bg-muted p-2">
                          <CategoryIcon
                            category={s.category ?? 'OTHER'}
                            className="h-4 w-4 text-muted-foreground"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium">{s.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {s.brand}
                            {s.brand && s.category ? ' • ' : ''}
                            {s.category ? categoryLabel(s.category) : ''}
                            {s.cancelUrl && (
                              <a
                                href={s.cancelUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="Trang huỷ gói"
                                className="ml-2 inline-flex items-center text-rose-600 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {s.plan ?? '—'}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{formatVND(s.price)}</p>
                      <p className="text-xs text-muted-foreground">
                        {BILLING_CYCLE_LABELS[s.billingCycle as BillingCycle] ?? s.billingCycle}
                      </p>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {monthly == null ? '—' : formatVND(monthly)}
                    </TableCell>
                    <TableCell className={rTone}>
                      <span className="inline-flex items-center gap-1 text-sm">
                        {rText.startsWith('Quá hạn') && (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                        {!rText.startsWith('Quá hạn') && (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {rText}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-transparent',
                          SUBSCRIPTION_STATUS_COLORS[s.status as SubscriptionStatus] ?? '',
                        )}
                      >
                        {SUBSCRIPTION_STATUS_LABELS[s.status as SubscriptionStatus] ?? s.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
