import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  Pencil,
  Bell,
  ShoppingBag,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import { PriceHistoryChart } from '@/components/charts/price-history';
import {
  UpdatePriceDialog,
  WishlistStatusButtons,
  MarkPurchasedButton,
  MarkSubscribedButton,
  DeleteWishlistButton,
} from '@/components/wishlist-actions';
import { api } from '@/lib/api';
import { categoryLabel } from '@/lib/types';
import {
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_PRIORITY_COLORS,
  WISHLIST_STATUS_LABELS,
  WISHLIST_STATUS_COLORS,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import { formatDate, formatVND, formatRelativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function WishlistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await api.wishlist.get(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/wishlist">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Wishlist
          </Link>
        </Button>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Lỗi tải món: {res.message ?? res.error}
        </div>
      </div>
    );
  }
  const item = res.data.item;
  // Go returns prices newest-first per OpenAPI WishlistDetail. We render
  // chronologically (oldest-first) for the chart.
  const prices = [...res.data.prices].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );

  const initial = item.initialPrice ?? null;
  const current = item.currentPrice ?? null;
  const delta =
    initial && current && initial !== current
      ? { pct: ((current - initial) / initial) * 100, down: current < initial }
      : null;
  const min = prices.length ? Math.min(...prices.map((p) => p.price)) : null;
  const max = prices.length ? Math.max(...prices.map((p) => p.price)) : null;
  const lastPriceAt =
    prices.length > 0
      ? new Date(prices[prices.length - 1].recordedAt)
      : item.currentPrice != null && item.updatedAt
        ? new Date(item.updatedAt)
        : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/wishlist">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Wishlist
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/wishlist/${item.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Sửa
            </Link>
          </Button>
          <UpdatePriceDialog itemId={item.id} currentPrice={item.currentPrice} />
          {item.status !== 'PURCHASED' && (
            <>
              <MarkPurchasedButton itemId={item.id} />
              <MarkSubscribedButton itemId={item.id} />
            </>
          )}
          <DeleteWishlistButton itemId={item.id} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted p-3">
              <CategoryIcon
                category={item.category ?? 'OTHER'}
                className="h-5 w-5 text-muted-foreground"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{item.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.brand}
                {item.brand && item.category ? ' • ' : ''}
                {item.category ? categoryLabel(item.category) : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={cn(
                'border-transparent',
                WISHLIST_STATUS_COLORS[item.status as WishlistStatus] ?? '',
              )}
            >
              {WISHLIST_STATUS_LABELS[item.status as WishlistStatus] ?? item.status}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'border-transparent',
                WISHLIST_PRIORITY_COLORS[item.priority as WishlistPriority] ?? '',
              )}
            >
              {WISHLIST_PRIORITY_LABELS[item.priority as WishlistPriority] ?? item.priority}
            </Badge>
          </div>
        </div>

        {item.purchasedDeviceId && (
          <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <ShoppingBag className="mr-1 inline h-4 w-4 text-muted-foreground" />
            Đã mua →{' '}
            <Link
              href={`/devices/${item.purchasedDeviceId}`}
              className="font-medium underline"
            >
              Xem thiết bị
            </Link>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Giá ban đầu</p>
            <p className="text-lg font-semibold">
              {item.initialPrice ? formatVND(item.initialPrice) : '—'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Giá hiện tại</p>
            <p className="text-lg font-semibold">
              {item.currentPrice ? formatVND(item.currentPrice) : '—'}
              {delta && (
                <span
                  className={cn(
                    'ml-2 inline-flex items-center gap-0.5 align-middle text-xs',
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
              )}
            </p>
            {lastPriceAt && (
              <p
                className="text-xs text-muted-foreground"
                title={formatDate(lastPriceAt)}
              >
                Cập nhật {formatRelativeDay(lastPriceAt)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Min / Max đã ghi</p>
            <p className="text-sm">
              {min ? formatVND(min) : '—'} / {max ? formatVND(max) : '—'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              <Calendar className="mr-1 inline h-3 w-3" />
              Ngày dự kiến mua
            </p>
            <p className="text-sm">
              {item.targetDate ? formatDate(new Date(item.targetDate)) : 'Chưa đặt'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {item.buyUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={item.buyUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Mở link mua
              </a>
            </Button>
          )}
          {item.reminderIntervalDays && (
            <span className="inline-flex items-center text-xs text-muted-foreground">
              <Bell className="mr-1 h-3 w-3" />
              Nhắc lại mỗi {item.reminderIntervalDays} ngày
            </span>
          )}
        </div>
      </div>

      {item.imageUrl && (
        <div className="overflow-hidden rounded-xl border bg-muted/20">
          {/* External product image — referrer-policy hides the URL from origin. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={item.name}
            referrerPolicy="no-referrer"
            className="mx-auto max-h-[480px] w-auto object-contain"
          />
        </div>
      )}

      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Lịch sử giá</h3>
          <span className="text-xs text-muted-foreground">
            {prices.length} điểm dữ liệu
          </span>
        </div>
        <PriceHistoryChart
          data={prices.map((p) => ({
            recordedAt: p.recordedAt,
            price: p.price,
          }))}
        />
        {prices.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {[...prices].reverse().slice(0, 8).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 text-muted-foreground"
              >
                <span>{formatDate(new Date(p.recordedAt))}</span>
                <span className="flex-1 truncate text-right">{p.note}</span>
                <span className="font-medium text-foreground">
                  {formatVND(p.price)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {item.notes && (
        <div className="rounded-xl border bg-card p-6">
          <h3 className="mb-3 text-base font-semibold">Ghi chú</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {item.notes}
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4">
        <p className="mb-3 text-xs text-muted-foreground">Đổi trạng thái nhanh</p>
        <WishlistStatusButtons itemId={item.id} status={item.status} />
      </div>
    </div>
  );
}
