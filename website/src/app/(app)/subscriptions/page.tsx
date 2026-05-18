import Link from 'next/link';
import { Plus, RefreshCw, ExternalLink, AlertTriangle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIconBadge } from '@/components/category-icon';
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
  SUBSCRIPTION_STATUSES,
  monthlyEquivalent,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';
import { differenceInDays } from 'date-fns';

export const dynamic = 'force-dynamic';

type RenewalTone = 'safe' | 'warn' | 'danger' | 'expired' | 'neutral';

function renewalLabel(
  date: Date,
  cycle: string,
): { text: string; tone: RenewalTone } {
  if (cycle === 'LIFETIME') return { text: 'Lifetime', tone: 'neutral' };
  const days = differenceInDays(date, new Date());
  if (days < 0) return { text: `Quá hạn ${Math.abs(days)} ngày`, tone: 'danger' };
  if (days === 0) return { text: 'Hôm nay', tone: 'warn' };
  if (days <= 3) return { text: `Còn ${days} ngày`, tone: 'danger' };
  if (days <= 7) return { text: `Còn ${days} ngày`, tone: 'warn' };
  if (days <= 30) return { text: `Còn ${days} ngày`, tone: 'safe' };
  return { text: formatDate(date), tone: 'neutral' };
}

const RENEWAL_PILL: Record<RenewalTone, string> = {
  safe: 'bg-emerald-soft text-emerald-ink',
  warn: 'bg-amber-soft text-amber-ink',
  danger: 'bg-rose-soft text-rose-ink',
  expired: 'bg-zinc-soft text-ink-2',
  neutral: 'bg-surface-2 text-ink-2',
};

const STATUS_PILL: Record<SubscriptionStatus, string> = {
  ACTIVE: 'bg-emerald-soft text-emerald-ink',
  PAUSED: 'bg-amber-soft text-amber-ink',
  CANCELED: 'bg-zinc-soft text-ink-2',
  EXPIRED: 'bg-rose-soft text-rose-ink',
};

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
  return { count: active.length, monthly, yearly, upcoming };
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
        <h1 className="display text-3xl text-ink">Gói đăng ký</h1>
        <div className="rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          Lỗi tải danh sách: {listRes.message ?? listRes.error}
        </div>
      </div>
    );
  }
  const all = listRes.data.subscriptions;
  const subs = applyFilter(all, filter);
  const totals = computeTotals(all);
  const isFiltered = Boolean(
    filter.q || filter.category || filter.billingCycle || (filter.status && filter.status !== 'ACTIVE_PAUSED'),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Gói định kỳ</p>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Gói đăng ký</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Hiển thị {subs.length} gói
            {isFiltered ? ' (đã lọc)' : ''}. Theo dõi chi phí định kỳ — biết tiền chảy đi đâu mỗi tháng.
          </p>
        </div>
        <Button asChild size="lg" className="rounded-pill">
          <Link href="/subscriptions/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm gói
          </Link>
        </Button>
      </div>

      {totals.count > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="stat-card tint-sky">
            <p className="stat-eyebrow">Mỗi tháng</p>
            <p className="display mt-1.5 text-3xl tabular-nums text-sky-ink">
              {formatVND(totals.monthly)}
            </p>
            <p className="mt-1 text-xs opacity-80">
              ~ {formatVND(totals.yearly)} / năm
            </p>
          </div>
          <div className="stat-card tint-primary">
            <p className="stat-eyebrow">Đang hoạt động</p>
            <p className="display mt-1.5 text-3xl tabular-nums text-primary-ink">
              {totals.count}
            </p>
            <p className="mt-1 text-xs opacity-80">gói đang chạy</p>
          </div>
          <div className="stat-card tint-amber">
            <p className="stat-eyebrow">Sắp gia hạn</p>
            {totals.upcoming.length === 0 ? (
              <p className="mt-2 text-sm opacity-80">Chưa có gói nào sắp charge</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {totals.upcoming.slice(0, 3).map((u) => {
                  const { text } = renewalLabel(new Date(u.renewalDate), u.billingCycle);
                  return (
                    <li key={u.id} className="flex items-center gap-2 truncate">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <Link
                        href={`/subscriptions/${u.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {u.name}
                      </Link>
                      <span className="ml-auto shrink-0 text-xs opacity-80">{text}</span>
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
          title={isFiltered ? 'Không có gì khớp bộ lọc' : 'Chưa có gói đăng ký nào'}
          description={
            isFiltered
              ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
              : 'Note lại các gói phần mềm/dịch vụ — Apple One, ChatGPT, Spotify, hosting...'
          }
          ctaHref="/subscriptions/new"
          ctaLabel="Thêm gói đầu tiên"
          cta={!isFiltered}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subs.map((s) => {
            const monthly = monthlyEquivalent(
              s.price,
              s.billingCycle as BillingCycle,
              s.intervalDays,
            );
            const renewalAt = new Date(s.renewalDate);
            const { text: rText, tone: rTone } = renewalLabel(renewalAt, s.billingCycle);
            const status = s.status as SubscriptionStatus;
            return (
              <Link
                key={s.id}
                href={`/subscriptions/${s.id}`}
                className="group flex h-full flex-col gap-4 rounded-2xl border-[1.5px] border-border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
              >
                <div className="flex items-start gap-3">
                  <CategoryIconBadge
                    category={s.category ?? 'OTHER'}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-display text-base font-bold text-ink">
                        {s.name}
                      </h3>
                      {s.cancelUrl && (
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.brand}
                      {s.brand && s.category ? ' • ' : ''}
                      {s.category ? categoryLabel(s.category) : ''}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold',
                      STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2',
                    )}
                  >
                    {SUBSCRIPTION_STATUS_LABELS[status] ?? s.status}
                  </span>
                </div>

                {s.plan && (
                  <p className="text-xs text-ink-2">
                    <span className="eyebrow mr-1.5">Plan</span>
                    {s.plan}
                  </p>
                )}

                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-dashed border-border pt-4">
                  <div>
                    <p className="eyebrow">Giá / chu kỳ</p>
                    <p className="mt-1 font-display text-xl font-bold tabular-nums text-ink">
                      {formatVND(s.price)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {BILLING_CYCLE_LABELS[s.billingCycle as BillingCycle] ?? s.billingCycle}
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow">~ / tháng</p>
                    <p className="mt-1 font-display text-xl font-bold tabular-nums text-ink-2">
                      {monthly == null ? '—' : formatVND(monthly)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-dashed border-border pt-3">
                  <span className="eyebrow">Gia hạn</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold',
                      RENEWAL_PILL[rTone],
                    )}
                  >
                    {rTone === 'danger' ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {rText}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
