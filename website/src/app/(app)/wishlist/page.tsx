import Link from 'next/link';
import {
  Plus,
  ExternalLink,
  Calendar,
  ArrowDown,
  ArrowUp,
  Heart,
  ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIconBadge } from '@/components/category-icon';
import { EmptyState } from '@/components/empty-state';
import { WishlistFilterBar } from '@/components/wishlist-filter-bar';
import { api } from '@/lib/api';
import type { WishlistItem } from '@/lib/api/wishlist';
import { getCategories } from '@/app/actions/catalog';
import { categoryLabel } from '@/lib/types';
import {
  WISHLIST_ACTIVE_STATUSES,
  WISHLIST_PRIORITIES,
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_PRIORITY_RANK,
  WISHLIST_STATUS_LABELS,
  WISHLIST_STATUSES,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Soft pill bgs per priority — coral palette, not stock Tailwind.
const PRIORITY_PILL: Record<WishlistPriority, string> = {
  MUST: 'bg-rose-soft text-rose-ink',
  WANT: 'bg-amber-soft text-amber-ink',
  MAYBE: 'bg-sky-soft text-sky-ink',
};

const STATUS_PILL: Record<WishlistStatus, string> = {
  WATCHING: 'bg-sky-soft text-sky-ink',
  DECIDED: 'bg-primary-soft text-primary-ink',
  SKIPPED: 'bg-zinc-soft text-ink-2',
  PURCHASED: 'bg-emerald-soft text-emerald-ink',
};

function priceDelta(current: number | null, initial: number | null) {
  if (!initial || !current || initial === current) return null;
  const pct = ((current - initial) / initial) * 100;
  return { pct, down: current < initial };
}

type WFilter = {
  q?: string;
  category?: string;
  status?: string;
  priority?: string;
  sort?: 'target' | 'priority' | 'recent' | 'price';
  dir?: 'asc' | 'desc';
};

function applyFilter(rows: WishlistItem[], f: WFilter): WishlistItem[] {
  let out = rows;
  if (f.q?.trim()) {
    const term = f.q.trim().toLowerCase();
    out = out.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        (i.brand?.toLowerCase().includes(term) ?? false) ||
        (i.notes?.toLowerCase().includes(term) ?? false),
    );
  }
  if (f.category) out = out.filter((i) => i.category === f.category);
  const status = f.status ?? 'ACTIVE';
  if (status === 'ACTIVE') {
    out = out.filter((i) => (WISHLIST_ACTIVE_STATUSES as readonly string[]).includes(i.status));
  } else if (status !== 'ALL' && (WISHLIST_STATUSES as readonly string[]).includes(status)) {
    out = out.filter((i) => i.status === status);
  }
  if (f.priority && (WISHLIST_PRIORITIES as readonly string[]).includes(f.priority)) {
    out = out.filter((i) => i.priority === f.priority);
  }
  const dir = f.dir ?? 'asc';
  const sort = f.sort ?? 'priority';
  const cmp = (a: number, b: number) => (dir === 'asc' ? a - b : b - a);
  out = [...out].sort((a, b) => {
    if (sort === 'recent') {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cmp(ta, tb);
    }
    if (sort === 'price') {
      return cmp(a.currentPrice ?? 0, b.currentPrice ?? 0);
    }
    if (sort === 'target') {
      const ta = a.targetDate ? new Date(a.targetDate).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.targetDate ? new Date(b.targetDate).getTime() : Number.POSITIVE_INFINITY;
      return cmp(ta, tb);
    }
    // priority
    const ra = WISHLIST_PRIORITY_RANK[a.priority as WishlistPriority] ?? 99;
    const rb = WISHLIST_PRIORITY_RANK[b.priority as WishlistPriority] ?? 99;
    if (ra !== rb) return dir === 'asc' ? ra - rb : rb - ra;
    const ta = a.targetDate ? new Date(a.targetDate).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.targetDate ? new Date(b.targetDate).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  return out;
}

function computeTotals(rows: WishlistItem[]) {
  const active = rows.filter((i) =>
    (WISHLIST_ACTIVE_STATUSES as readonly string[]).includes(i.status),
  );
  const totalPrice = active.reduce(
    (sum, i) => sum + (i.currentPrice ?? i.initialPrice ?? 0),
    0,
  );
  const upcoming = active
    .filter((i) => i.targetDate)
    .map((i) => ({ ...i, _t: i.targetDate ? new Date(i.targetDate).getTime() : 0 }))
    .sort((a, b) => a._t - b._t)
    .slice(0, 3);
  return { count: active.length, totalPrice, upcoming };
}

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    priority?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const sp = await searchParams;
  const filter: WFilter = {
    q: sp.q,
    category: sp.category,
    status: sp.status,
    priority: sp.priority,
    sort: (sp.sort as WFilter['sort']) ?? 'priority',
    dir: (sp.dir as 'asc' | 'desc') ?? 'asc',
  };

  const [listRes, categories] = await Promise.all([
    api.wishlist.list(),
    getCategories(),
  ]);
  if (!listRes.ok) {
    return (
      <div className="space-y-4">
        <h1 className="display text-3xl text-ink">Đang thèm</h1>
        <div className="rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          Lỗi tải wishlist: {listRes.message ?? listRes.error}
        </div>
      </div>
    );
  }
  const all = listRes.data.items;
  const items = applyFilter(all, filter);
  const totals = computeTotals(all);
  const isFiltered = Boolean(
    filter.q || filter.category || filter.priority || (filter.status && filter.status !== 'ACTIVE'),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Đang thèm</p>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Wishlist</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Hiển thị {items.length} món
            {isFiltered ? ' (đã lọc)' : ''}. Note lại đồ mày đang để mắt — đợi sale là nhào vô.
          </p>
        </div>
        <Button asChild size="lg" className="rounded-pill">
          <Link href="/wishlist/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm món
          </Link>
        </Button>
      </div>

      {totals.count > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="stat-card tint-rose">
            <p className="stat-eyebrow">Đang theo dõi</p>
            <p className="display mt-1.5 text-3xl tabular-nums text-rose-ink">
              {totals.count}
            </p>
            <p className="mt-1 text-xs opacity-80">món trong list</p>
          </div>
          <div className="stat-card tint-violet">
            <p className="stat-eyebrow">Tổng tiền</p>
            <p className="display mt-1.5 text-3xl tabular-nums text-violet-ink">
              {formatVND(totals.totalPrice)}
            </p>
            <p className="mt-1 text-xs opacity-80">theo giá hiện tại</p>
          </div>
          <div className="stat-card tint-amber">
            <p className="stat-eyebrow">Sắp tới</p>
            {totals.upcoming.length === 0 ? (
              <p className="mt-2 text-sm opacity-80">Chưa đặt ngày dự kiến</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {totals.upcoming.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 truncate">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <Link
                      href={`/wishlist/${u.id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {u.name}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs opacity-80">
                      {u.targetDate ? formatDate(new Date(u.targetDate)) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <WishlistFilterBar categories={categories} />

      {items.length === 0 ? (
        <EmptyState
          icon={Heart}
          tone="rose"
          title={
            isFiltered ? 'Không có gì khớp bộ lọc' : 'Wishlist trống — thêm cái mày thèm đi'
          }
          description={
            isFiltered
              ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
              : 'Note lại những món mày đang để mắt — giá, link, deadline...'
          }
          ctaHref="/wishlist/new"
          ctaLabel="Thêm món đầu tiên"
          cta={!isFiltered}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const delta = priceDelta(it.currentPrice, it.initialPrice);
            const priority = it.priority as WishlistPriority;
            const status = it.status as WishlistStatus;
            return (
              <Link
                key={it.id}
                href={`/wishlist/${it.id}`}
                className="group flex h-full flex-col gap-4 rounded-2xl border-[1.5px] border-border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
              >
                {/* Thumb / dashed placeholder */}
                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface-2">
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageUrl}
                      alt={it.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[repeating-linear-gradient(45deg,hsl(var(--surface-2)),hsl(var(--surface-2))_8px,hsl(var(--surface-3))_8px,hsl(var(--surface-3))_16px)] text-muted-foreground">
                      <CategoryIconBadge
                        category={it.category ?? 'OTHER'}
                        size="lg"
                        className="opacity-90"
                      />
                      <ImageIcon className="absolute right-2 top-2 h-3.5 w-3.5 opacity-50" />
                    </div>
                  )}
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-semibold shadow-soft',
                        PRIORITY_PILL[priority] ?? 'bg-zinc-soft text-ink-2',
                      )}
                    >
                      {WISHLIST_PRIORITY_LABELS[priority] ?? it.priority}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-semibold shadow-soft',
                        STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2',
                      )}
                    >
                      {WISHLIST_STATUS_LABELS[status] ?? it.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CategoryIconBadge category={it.category ?? 'OTHER'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-display text-base font-bold text-ink">
                        {it.name}
                      </h3>
                      {it.buyUrl && (
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {it.brand}
                      {it.brand && it.category ? ' • ' : ''}
                      {it.category ? categoryLabel(it.category) : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-dashed border-border pt-4">
                  <div>
                    <p className="eyebrow">Hiện tại</p>
                    <p className="mt-1 font-display text-xl font-bold tabular-nums text-ink">
                      {it.currentPrice ? formatVND(it.currentPrice) : '—'}
                    </p>
                    {delta && (
                      <span
                        className={cn(
                          'mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold',
                          delta.down ? 'text-emerald-ink' : 'text-rose-ink',
                        )}
                      >
                        {delta.down ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUp className="h-3 w-3" />
                        )}
                        {Math.abs(delta.pct).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="eyebrow">Ban đầu</p>
                    <p className="mt-1 font-display text-base font-semibold tabular-nums text-ink-2">
                      {it.initialPrice ? formatVND(it.initialPrice) : '—'}
                    </p>
                    {it.targetDate && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-pill bg-amber-soft px-2 py-0.5 text-[10px] font-semibold text-amber-ink">
                        <Calendar className="h-3 w-3" />
                        {formatDate(new Date(it.targetDate))}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
