import Link from 'next/link';
import { Plus, ExternalLink, Calendar, ArrowDown, ArrowUp, Heart } from 'lucide-react';
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
import { WishlistFilterBar } from '@/components/wishlist-filter-bar';
import { api } from '@/lib/api';
import type { WishlistItem } from '@/lib/api/wishlist';
import { getCategories } from '@/app/actions/catalog';
import { categoryLabel } from '@/lib/types';
import {
  WISHLIST_ACTIVE_STATUSES,
  WISHLIST_PRIORITIES,
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_PRIORITY_COLORS,
  WISHLIST_PRIORITY_RANK,
  WISHLIST_STATUS_LABELS,
  WISHLIST_STATUS_COLORS,
  WISHLIST_STATUSES,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

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
        <h1 className="text-3xl font-bold tracking-tight">Đang thèm</h1>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Lỗi tải wishlist: {listRes.message ?? listRes.error}
        </div>
      </div>
    );
  }
  const all = listRes.data.items;
  const items = applyFilter(all, filter);
  const totals = computeTotals(all);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Đang thèm
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Hiển thị {items.length} món
            {filter.q || filter.category || filter.priority ? ' (đã lọc)' : ''}.
            Note lại đồ mày đang để mắt — đợi sale là nhào vô.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="rounded-full transition-transform hover:scale-[1.02]"
        >
          <Link href="/wishlist/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm món
          </Link>
        </Button>
      </div>

      {totals.count > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-rose-500/10 bg-rose-500/5 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Đang theo dõi
            </p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight">{totals.count}</p>
            <p className="mt-1 text-xs text-muted-foreground">món trong list</p>
          </div>
          <div className="rounded-2xl border border-violet-500/10 bg-violet-500/5 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tổng tiền
            </p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight">
              {formatVND(totals.totalPrice)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">theo giá hiện tại</p>
          </div>
          <div className="rounded-2xl border border-amber-500/10 bg-amber-500/5 p-5 shadow-sm transition-all duration-200 hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sắp tới
            </p>
            {totals.upcoming.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Chưa đặt ngày dự kiến</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {totals.upcoming.map((u) => (
                  <li key={u.id} className="truncate">
                    <Calendar className="mr-1 inline h-3 w-3 text-muted-foreground" />
                    {u.targetDate ? formatDate(new Date(u.targetDate)) : ''}
                    {' — '}
                    <Link href={`/wishlist/${u.id}`} className="hover:underline">
                      {u.name}
                    </Link>
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
            filter.q || filter.category
              ? 'Không có gì khớp bộ lọc'
              : 'Wishlist trống — thêm cái mày thèm đi'
          }
          description={
            filter.q || filter.category
              ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
              : 'Note lại những món mày đang để mắt — giá, link, deadline...'
          }
          ctaHref="/wishlist/new"
          ctaLabel="Thêm món đầu tiên"
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Sản phẩm</TableHead>
                <TableHead className="hidden md:table-cell">Giá ban đầu</TableHead>
                <TableHead>Giá hiện tại</TableHead>
                <TableHead className="hidden lg:table-cell">Δ</TableHead>
                <TableHead className="hidden md:table-cell">Target</TableHead>
                <TableHead>Mức</TableHead>
                <TableHead className="hidden sm:table-cell">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, idx) => {
                const delta = priceDelta(it.currentPrice, it.initialPrice);
                return (
                  <TableRow key={it.id} className="transition-colors hover:bg-accent/50">
                    <TableCell className="text-xs text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/wishlist/${it.id}`}
                        className="flex items-start gap-3"
                      >
                        <div className="rounded-md bg-muted p-2">
                          <CategoryIcon
                            category={it.category ?? 'OTHER'}
                            className="h-4 w-4 text-muted-foreground"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium">{it.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {it.brand}
                            {it.brand && it.category ? ' • ' : ''}
                            {it.category ? categoryLabel(it.category) : ''}
                            {it.buyUrl && (
                              <a
                                href={it.buyUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="ml-2 inline-flex items-center text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {it.initialPrice ? formatVND(it.initialPrice) : '—'}
                    </TableCell>
                    <TableCell className="font-medium">
                      {it.currentPrice ? formatVND(it.currentPrice) : '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {delta ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 text-xs',
                            delta.down ? 'text-emerald-600' : 'text-rose-600',
                          )}
                        >
                          {delta.down ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUp className="h-3 w-3" />
                          )}
                          {Math.abs(delta.pct).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {it.targetDate ? formatDate(new Date(it.targetDate)) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-transparent',
                          WISHLIST_PRIORITY_COLORS[it.priority as WishlistPriority] ?? '',
                        )}
                      >
                        {WISHLIST_PRIORITY_LABELS[it.priority as WishlistPriority] ?? it.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-transparent',
                          WISHLIST_STATUS_COLORS[it.status as WishlistStatus] ?? '',
                        )}
                      >
                        {WISHLIST_STATUS_LABELS[it.status as WishlistStatus] ?? it.status}
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
