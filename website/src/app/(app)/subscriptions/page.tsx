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
import { api } from '@/lib/api';
import type { Subscription } from '@/lib/api/subscriptions';
import { getCategories } from '@/app/actions/catalog';
import { categoryLabel } from '@/lib/types';
import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_ACTIVE_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_BADGE_VARIANT,
  SUBSCRIPTION_STATUSES,
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

type SubFilter = {
  q?: string;
  category?: string;
  status?: string;
  billingCycle?: string;
  sort?: 'renewal' | 'name' | 'price' | 'monthly' | 'recent';
  dir?: 'asc' | 'desc';
};

// Filter + sort + totals are computed client-side from the Go list response.
// For ≤100 subs/user (the per-user cap) this is well under 1ms; no need to
// push these into Go yet.
function applyFilter(rows: Subscription[], f: SubFilter): Subscription[] {
  let out = rows;
  if (f.q?.trim()) {
    const term = f.q.trim().toLowerCase();
    out = out.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        (s.brand?.toLowerCase().includes(term) ?? false) ||
        (s.plan?.toLowerCase().includes(term) ?? false) ||
        (s.notes?.toLowerCase().includes(term) ?? false),
    );
  }
  if (f.category) out = out.filter((s) => s.category === f.category);
  const status = f.status ?? 'ACTIVE_PAUSED';
  if (status === 'ACTIVE_PAUSED') {
    out = out.filter((s) =>
      (SUBSCRIPTION_ACTIVE_STATUSES as readonly string[]).includes(s.status),
    );
  } else if (
    status !== 'ALL' &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
  ) {
    out = out.filter((s) => s.status === status);
  }
  if (f.billingCycle && (BILLING_CYCLES as readonly string[]).includes(f.billingCycle)) {
    out = out.filter((s) => s.billingCycle === f.billingCycle);
  }
  const dir = f.dir ?? 'asc';
  const sort = f.sort ?? 'renewal';
  const cmp = (a: number, b: number) => (dir === 'asc' ? a - b : b - a);
  const cmpStr = (a: string, b: string) => (dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
  out = [...out].sort((a, b) => {
    if (sort === 'name') return cmpStr(a.name, b.name);
    if (sort === 'price') return cmp(a.price, b.price);
    if (sort === 'recent') {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cmp(ta, tb);
    }
    if (sort === 'monthly') {
      const ma = monthlyEquivalent(a.price, a.billingCycle as BillingCycle, a.intervalDays) ?? 0;
      const mb = monthlyEquivalent(b.price, b.billingCycle as BillingCycle, b.intervalDays) ?? 0;
      return cmp(ma, mb);
    }
    // default renewal
    return cmp(new Date(a.renewalDate).getTime(), new Date(b.renewalDate).getTime());
  });
  return out;
}

function computeTotals(rows: Subscription[]) {
  const active = rows.filter((s) =>
    (SUBSCRIPTION_ACTIVE_STATUSES as readonly string[]).includes(s.status),
  );
  let monthly = 0;
  let yearly = 0;
  for (const s of active) {
    const m = monthlyEquivalent(s.price, s.billingCycle as BillingCycle, s.intervalDays);
    if (m != null) {
      monthly += m;
      yearly += m * 12;
    }
  }
  const upcoming = active
    .filter((s) => s.status === 'ACTIVE' && s.autoRenew && s.billingCycle !== 'LIFETIME')
    .map((s) => ({ ...s, _renewalAt: new Date(s.renewalDate).getTime() }))
    .sort((a, b) => a._renewalAt - b._renewalAt)
    .slice(0, 5);
  return {
    count: active.length,
    monthly,
    yearly,
    upcoming,
  };
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
  const sp = await searchParams;
  const filter: SubFilter = {
    q: sp.q,
    category: sp.category,
    status: sp.status,
    billingCycle: sp.billingCycle,
    sort: (sp.sort as SubFilter['sort']) ?? 'renewal',
    dir: (sp.dir as 'asc' | 'desc') ?? 'asc',
  };

  const [listRes, categories] = await Promise.all([
    api.subscriptions.list(),
    getCategories(),
  ]);
  if (!listRes.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Gói đăng ký</h1>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Lỗi tải danh sách: {listRes.message ?? listRes.error}
        </div>
      </div>
    );
  }
  const all = listRes.data.subscriptions;
  const subs = applyFilter(all, filter);
  const totals = computeTotals(all);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Gói đăng ký</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Hiển thị {subs.length} gói
            {filter.q || filter.category || filter.billingCycle ? ' (đã lọc)' : ''}.
            Theo dõi chi phí định kỳ — biết tiền chảy đi đâu mỗi tháng.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="rounded-full transition-transform hover:scale-[1.02]"
        >
          <Link href="/subscriptions/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm gói
          </Link>
        </Button>
      </div>

      {totals.count > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-sky-500/10 bg-sky-500/5 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mỗi tháng
            </p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight">
              {formatVND(totals.monthly)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ~ {formatVND(totals.yearly)} / năm
            </p>
          </div>
          <div className="rounded-2xl border border-primary/10 bg-primary/5 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Đang hoạt động
            </p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight">{totals.count}</p>
            <p className="mt-1 text-xs text-muted-foreground">gói đang chạy</p>
          </div>
          <div className="rounded-2xl border border-amber-500/10 bg-amber-500/5 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sắp gia hạn
            </p>
            {totals.upcoming.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Chưa có gói nào sắp charge</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {totals.upcoming.slice(0, 3).map((u) => {
                  const { text, tone } = renewalLabel(new Date(u.renewalDate), u.billingCycle);
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
          icon={RefreshCw}
          tone="sky"
          title={
            filter.q || filter.category
              ? 'Không có gì khớp bộ lọc'
              : 'Chưa có gói đăng ký nào'
          }
          description={
            filter.q || filter.category
              ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
              : 'Note lại các gói phần mềm/dịch vụ — Apple One, ChatGPT, Spotify, hosting...'
          }
          ctaHref="/subscriptions/new"
          ctaLabel="Thêm gói đầu tiên"
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
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
                const renewalAt = new Date(s.renewalDate);
                const { text: rText, tone: rTone } = renewalLabel(
                  renewalAt,
                  s.billingCycle,
                );
                return (
                  <TableRow key={s.id} className="transition-colors hover:bg-accent/50">
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
                        variant={
                          SUBSCRIPTION_STATUS_BADGE_VARIANT[s.status as SubscriptionStatus] ??
                          'secondary'
                        }
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
