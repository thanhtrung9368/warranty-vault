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
  StickyNote,
  Tag,
  Hash,
  Info,
  LineChart as LineChartIcon,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIconBadge } from '@/components/category-icon';
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
  WISHLIST_STATUS_LABELS,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import { formatDate, formatVND, formatRelativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

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
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-pill">
          <Link href="/wishlist">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Wishlist
          </Link>
        </Button>
        <div className="rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          Lỗi tải món: {res.message ?? res.error}
        </div>
      </div>
    );
  }
  const item = res.data.item;
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

  const priority = item.priority as WishlistPriority;
  const status = item.status as WishlistStatus;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-pill">
          <Link href="/wishlist">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Wishlist
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-pill border-border-strong"
          >
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

      <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <CategoryIconBadge category={item.category ?? 'OTHER'} size="lg" />
            <div className="min-w-0">
              <h1 className="display text-3xl text-ink">{item.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.brand}
                {item.brand && item.category ? ' • ' : ''}
                {item.category ? categoryLabel(item.category) : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-pill px-3 py-1 text-xs font-semibold',
                STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2',
              )}
            >
              {WISHLIST_STATUS_LABELS[status] ?? item.status}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-pill px-3 py-1 text-xs font-semibold',
                PRIORITY_PILL[priority] ?? 'bg-zinc-soft text-ink-2',
              )}
            >
              {WISHLIST_PRIORITY_LABELS[priority] ?? item.priority}
            </span>
          </div>
        </div>

        {item.purchasedDeviceId && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-soft px-4 py-3 text-sm text-emerald-ink">
            <ShoppingBag className="h-4 w-4" />
            Đã mua →{' '}
            <Link
              href={`/devices/${item.purchasedDeviceId}`}
              className="font-semibold underline"
            >
              Xem thiết bị
            </Link>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="eyebrow">Giá ban đầu</p>
            <p className="display mt-1 text-2xl tabular-nums text-ink">
              {item.initialPrice ? formatVND(item.initialPrice) : '—'}
            </p>
          </div>
          <div
            className={cn(
              'rounded-xl border p-4',
              delta != null && delta.down
                ? 'border-emerald-soft bg-emerald-soft text-emerald-ink'
                : 'border-border bg-surface',
            )}
          >
            <p className="eyebrow">Giá hiện tại</p>
            <p className="display mt-1 text-2xl tabular-nums">
              {item.currentPrice ? formatVND(item.currentPrice) : '—'}
              {delta && (
                <span
                  className={cn(
                    'ml-2 inline-flex items-center gap-0.5 align-middle text-sm',
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
            </p>
            {lastPriceAt && (
              <p
                className="mt-0.5 text-xs opacity-80"
                title={formatDate(lastPriceAt)}
              >
                Cập nhật {formatRelativeDay(lastPriceAt)}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="eyebrow">Min / Max</p>
            <p className="mt-1 text-base font-bold tabular-nums">
              <span className="text-emerald-ink">{min ? formatVND(min) : '—'}</span>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className="text-rose-ink">{max ? formatVND(max) : '—'}</span>
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="eyebrow flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Ngày dự kiến
            </p>
            <p className="display mt-1 text-xl">
              {item.targetDate ? formatDate(new Date(item.targetDate)) : 'Chưa đặt'}
            </p>
            {item.targetDate && (
              <p className="text-xs text-muted-foreground">
                {formatRelativeDay(new Date(item.targetDate))}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <LineChartIcon className="h-4 w-4" />
              Lịch sử giá
              <span className="ml-auto inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
                {prices.length} điểm
              </span>
            </h3>
            <PriceHistoryChart
              data={prices.map((p) => ({
                recordedAt: p.recordedAt,
                price: p.price,
              }))}
            />
            {prices.length > 0 && (
              <ul className="mt-4 divide-y divide-dashed divide-border text-sm">
                {[...prices].reverse().slice(0, 8).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <span className="min-w-[110px] font-semibold text-ink">
                      {formatDate(new Date(p.recordedAt))}
                    </span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {p.note ?? '—'}
                    </span>
                    <span className="font-display tabular-nums font-bold text-ink">
                      {formatVND(p.price)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {item.notes && (
            <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
              <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
                <StickyNote className="h-4 w-4" />
                Ghi chú
              </h3>
              <p className="whitespace-pre-wrap text-sm text-ink-2">{item.notes}</p>
            </div>
          )}

          <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Zap className="h-4 w-4" />
              Đổi trạng thái nhanh
            </h3>
            <WishlistStatusButtons itemId={item.id} status={item.status} />
          </div>
        </div>

        <div className="space-y-4">
          {item.buyUrl && (
            <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
              <h3 className="mb-4 flex items-center gap-2 font-display text-base font-bold text-ink">
                <ExternalLink className="h-4 w-4" />
                Mua ở đâu
              </h3>
              <Button asChild className="w-full rounded-pill">
                <a href={item.buyUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Mở link mua
                </a>
              </Button>
            </div>
          )}

          <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
            <h3 className="mb-2 flex items-center gap-2 font-display text-base font-bold text-ink">
              <Info className="h-4 w-4" />
              Thông tin
            </h3>
            <div className="flex flex-col">
              {item.reminderIntervalDays && (
                <div className="info-row">
                  <Bell className="info-row-icon h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="info-row-label">Nhắc lại</div>
                    <div className="info-row-value">
                      Mỗi {item.reminderIntervalDays} ngày
                    </div>
                  </div>
                </div>
              )}
              {item.category && (
                <div className="info-row">
                  <Tag className="info-row-icon h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="info-row-label">Loại</div>
                    <div className="info-row-value">{categoryLabel(item.category)}</div>
                  </div>
                </div>
              )}
              <div className="info-row">
                <Hash className="info-row-icon h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <div className="info-row-label">ID</div>
                  <div className="info-row-value font-mono text-xs">{item.id}</div>
                </div>
              </div>
            </div>
          </div>

          {item.imageUrl && (
            <div className="overflow-hidden rounded-2xl border-[1.5px] border-border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                alt={item.name}
                referrerPolicy="no-referrer"
                className="mx-auto max-h-[420px] w-auto object-contain"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
