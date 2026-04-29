import Link from 'next/link';
import { Plus, ExternalLink, Calendar, ArrowDown, ArrowUp } from 'lucide-react';
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
import { listWishlist, wishlistTotals, type WishlistFilter } from '@/lib/wishlist';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/app/actions/catalog';
import { categoryLabel } from '@/lib/types';
import {
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_PRIORITY_COLORS,
  WISHLIST_STATUS_LABELS,
  WISHLIST_STATUS_COLORS,
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
  const user = await requireUser();
  const sp = await searchParams;
  const filter: WishlistFilter = {
    q: sp.q,
    category: sp.category,
    status: sp.status,
    priority: sp.priority,
    sort: (sp.sort as WishlistFilter['sort']) ?? 'priority',
    dir: (sp.dir as 'asc' | 'desc') ?? 'asc',
  };
  const [items, categories, totals] = await Promise.all([
    listWishlist(user.id, filter),
    getCategories(),
    wishlistTotals(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Đang thèm</h1>
          <p className="text-sm text-muted-foreground">
            Hiển thị {items.length} món
            {filter.q || filter.category || filter.priority ? ' (đã lọc)' : ''}
          </p>
        </div>
        <Button asChild>
          <Link href="/wishlist/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm món
          </Link>
        </Button>
      </div>

      {totals.count > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Tổng món đang theo dõi</p>
            <p className="mt-1 text-2xl font-bold">{totals.count}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Tổng tiền (giá hiện tại)</p>
            <p className="mt-1 text-2xl font-bold">{formatVND(totals.totalPrice)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Sắp tới</p>
            {totals.upcoming.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Chưa đặt ngày dự kiến</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {totals.upcoming.map((u) => (
                  <li key={u.id} className="truncate">
                    <Calendar className="mr-1 inline h-3 w-3 text-muted-foreground" />
                    {u.targetDate ? formatDate(u.targetDate) : ''}
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
          title="Chưa có món nào trong wishlist"
          description={
            filter.q || filter.category
              ? 'Không tìm thấy món phù hợp với bộ lọc.'
              : 'Note lại những món mày đang để mắt — giá, link, deadline...'
          }
          cta={false}
        />
      ) : (
        <div className="rounded-xl border bg-card">
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
                  <TableRow key={it.id}>
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
                      {it.targetDate ? formatDate(it.targetDate) : '—'}
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
