import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  Pencil,
  CreditCard,
  Mail,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Wallet,
  StickyNote,
  Zap,
} from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { CategoryIconBadge } from '@/components/category-icon';
import { PriceHistoryChart } from '@/components/charts/lazy';
import {
  LogPaymentDialog,
  RenewNowButton,
  SubscriptionStatusButtons,
  DeleteSubscriptionButton,
} from '@/components/subscription-actions';
import { api } from '@/lib/api';
import { billingCycleLabel, categoryLabel, subscriptionStatusLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import {
  monthlyEquivalent,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import { formatDate, formatVND, formatRelativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_PILL: Record<SubscriptionStatus, string> = {
  ACTIVE: 'bg-emerald-soft text-emerald-ink',
  PAUSED: 'bg-amber-soft text-amber-ink',
  CANCELED: 'bg-zinc-soft text-ink-2',
  EXPIRED: 'bg-rose-soft text-rose-ink',
};

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { locale, t } = await getI18n();
  const res = await api.subscriptions.get(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-pill">
          <Link href="/subscriptions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('Gói đăng ký')}
          </Link>
        </Button>
        <div className="rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          {t('Lỗi tải gói: {message}', { message: res.message ?? res.error })}
        </div>
      </div>
    );
  }
  const sub = res.data.subscription;

  const renewalDate = new Date(sub.renewalDate);
  const monthly = monthlyEquivalent(
    sub.price,
    sub.billingCycle as BillingCycle,
    sub.intervalDays,
  );
  const totalSpent = sub.payments.reduce((s, p) => s + p.amount, 0);
  const daysToRenewal = differenceInDays(renewalDate, new Date());
  const isOverdue = sub.billingCycle !== 'LIFETIME' && daysToRenewal < 0;
  const isLifetime = sub.billingCycle === 'LIFETIME';
  const status = sub.status as SubscriptionStatus;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-pill">
          <Link href="/subscriptions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('Gói đăng ký')}
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-pill border-border-strong"
          >
            <Link href={`/subscriptions/${sub.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              {t('Sửa')}
            </Link>
          </Button>
          <LogPaymentDialog subId={sub.id} defaultAmount={sub.price} />
          {!isLifetime && <RenewNowButton subId={sub.id} />}
          <DeleteSubscriptionButton subId={sub.id} />
        </div>
      </div>

      <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <CategoryIconBadge category={sub.category ?? 'OTHER'} size="lg" />
            <div className="min-w-0">
              <h1 className="display text-3xl text-ink">{sub.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {sub.brand}
                {sub.brand && sub.plan ? ' • ' : ''}
                {sub.plan}
                {(sub.brand || sub.plan) && sub.category ? ' • ' : ''}
                {sub.category ? categoryLabel(sub.category, locale) : ''}
              </p>
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-pill px-3 py-1.5 text-sm font-semibold',
              STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2',
            )}
          >
            {subscriptionStatusLabel(status, locale)}
          </span>
        </div>

        {isOverdue && sub.autoRenew && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-soft px-4 py-3 text-sm text-amber-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t('Đã quá hạn')} <b>{Math.abs(daysToRenewal)}</b>{' '}
              {t('ngày — cron sẽ tự log payment kỳ này.', {
                count: Math.abs(daysToRenewal),
              })}
            </span>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="eyebrow">{t('Giá / chu kỳ')}</p>
            <p className="display mt-1 text-2xl tabular-nums text-ink">
              {formatVND(sub.price, locale)}
            </p>
            <p className="text-xs text-muted-foreground">
              {billingCycleLabel(sub.billingCycle as BillingCycle, locale)}
              {sub.billingCycle === 'CUSTOM' && sub.intervalDays
                ? ' ' +
                  t('({days} ngày)', {
                    days: sub.intervalDays,
                    count: sub.intervalDays,
                  })
                : ''}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="eyebrow">{t('Quy đổi / tháng')}</p>
            <p className="display mt-1 text-2xl tabular-nums text-ink">
              {formatVND(monthly, locale)}
            </p>
          </div>
          <div
            className={cn(
              'rounded-xl border p-4',
              isOverdue
                ? 'border-amber-soft bg-amber-soft text-amber-ink'
                : 'border-border bg-surface',
            )}
          >
            <p className="eyebrow flex items-center gap-1">
              <Calendar className="h-3 w-3" /> {t('Gia hạn tới')}
            </p>
            <p className="display mt-1 text-xl">
              {isLifetime ? 'Lifetime' : formatDate(renewalDate, locale)}
            </p>
            {!isLifetime && (
              <p className={cn('text-xs', isOverdue ? 'font-semibold' : 'text-muted-foreground')}>
                {daysToRenewal >= 0
                  ? t('Còn {days} ngày', { days: daysToRenewal, count: daysToRenewal })
                  : t('Quá {days} ngày', {
                      days: Math.abs(daysToRenewal),
                      count: Math.abs(daysToRenewal),
                    })}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="eyebrow">{t('Đã chi tổng')}</p>
            <p className="display mt-1 text-2xl tabular-nums text-ink">
              {formatVND(totalSpent, locale)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('qua {count} kỳ', { count: sub.payments.length })}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Wallet className="h-4 w-4" />
              {t('Lịch sử thanh toán')}
              <span className="ml-auto inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
                {t('{count} kỳ', { count: sub.payments.length })}
              </span>
            </h3>
            <PriceHistoryChart
              data={sub.payments.map((p) => ({
                recordedAt: p.paidAt,
                price: p.amount,
              }))}
            />
            {sub.payments.length > 0 && (
              <ul className="mt-4 divide-y divide-dashed divide-border text-sm">
                {[...sub.payments].reverse().slice(0, 12).map((p) => {
                  const paidAt = new Date(p.paidAt);
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                      <span className="min-w-[110px]">
                        <span className="block font-semibold text-ink">
                          {formatDate(paidAt, locale)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeDay(paidAt, locale)}
                        </span>
                      </span>
                      <span className="flex-1 truncate text-muted-foreground">
                        {p.note ?? '—'}
                      </span>
                      <span className="font-display tabular-nums font-bold text-ink">
                        {formatVND(p.amount, locale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {sub.notes && (
            <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
              <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
                <StickyNote className="h-4 w-4" />
                {t('Ghi chú')}
              </h3>
              <p className="whitespace-pre-wrap text-sm text-ink-2">{sub.notes}</p>
            </div>
          )}

          <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Zap className="h-4 w-4" />
              {t('Đổi trạng thái nhanh')}
            </h3>
            <SubscriptionStatusButtons subId={sub.id} status={sub.status} />
          </div>
        </div>

        <div className="space-y-4">
          {(sub.manageUrl || sub.cancelUrl) && (
            <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
              <h3 className="mb-4 flex items-center gap-2 font-display text-base font-bold text-ink">
                <ExternalLink className="h-4 w-4" />
                {t('Liên kết')}
              </h3>
              <div className="flex flex-col gap-2">
                {sub.manageUrl && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="rounded-pill border-border-strong"
                  >
                    <a href={sub.manageUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('Quản lý gói')}
                    </a>
                  </Button>
                )}
                {sub.cancelUrl && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
                  >
                    <a href={sub.cancelUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('Huỷ gói')}
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft">
            <h3 className="mb-2 flex items-center gap-2 font-display text-base font-bold text-ink">
              <CreditCard className="h-4 w-4" />
              {t('Tài khoản')}
            </h3>
            <div className="flex flex-col">
              {sub.accountEmail && (
                <div className="info-row">
                  <Mail className="info-row-icon h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="info-row-label">Email</div>
                    <div className="info-row-value truncate">{sub.accountEmail}</div>
                  </div>
                </div>
              )}
              {sub.paymentMethod && (
                <div className="info-row">
                  <CreditCard className="info-row-icon h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="info-row-label">{t('Thanh toán')}</div>
                    <div className="info-row-value">{sub.paymentMethod}</div>
                  </div>
                </div>
              )}
              <div className="info-row">
                <RefreshCw className="info-row-icon h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <div className="info-row-label">{t('Tự gia hạn')}</div>
                  <div className="info-row-value">
                    {sub.autoRenew ? t('✓ Bật') : t('— Tắt')}
                  </div>
                </div>
              </div>
              <div className="info-row">
                <Calendar className="info-row-icon h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <div className="info-row-label">{t('Bắt đầu từ')}</div>
                  <div className="info-row-value">
                    {formatDate(new Date(sub.startedAt), locale)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
