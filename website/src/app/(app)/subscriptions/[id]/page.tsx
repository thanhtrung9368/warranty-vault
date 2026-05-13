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
} from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import { PriceHistoryChart } from '@/components/charts/price-history';
import {
  LogPaymentDialog,
  RenewNowButton,
  SubscriptionStatusButtons,
  DeleteSubscriptionButton,
} from '@/components/subscription-actions';
import { api } from '@/lib/api';
import { categoryLabel } from '@/lib/types';
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_BADGE_VARIANT,
  monthlyEquivalent,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import { formatDate, formatVND, formatRelativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await api.subscriptions.get(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/subscriptions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Đăng ký
          </Link>
        </Button>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Lỗi tải gói: {res.message ?? res.error}
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/subscriptions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Đăng ký
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/subscriptions/${sub.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Sửa
            </Link>
          </Button>
          <LogPaymentDialog subId={sub.id} defaultAmount={sub.price} />
          {!isLifetime && <RenewNowButton subId={sub.id} />}
          <DeleteSubscriptionButton subId={sub.id} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-muted p-3">
              <CategoryIcon
                category={sub.category ?? 'OTHER'}
                className="h-5 w-5 text-muted-foreground"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{sub.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {sub.brand}
                {sub.brand && sub.plan ? ' • ' : ''}
                {sub.plan}
                {(sub.brand || sub.plan) && sub.category ? ' • ' : ''}
                {sub.category ? categoryLabel(sub.category) : ''}
              </p>
            </div>
          </div>
          <Badge
            variant={
              SUBSCRIPTION_STATUS_BADGE_VARIANT[sub.status as SubscriptionStatus] ??
              'secondary'
            }
          >
            {SUBSCRIPTION_STATUS_LABELS[sub.status as SubscriptionStatus] ?? sub.status}
          </Badge>
        </div>

        {isOverdue && sub.autoRenew && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Đã quá hạn {Math.abs(daysToRenewal)} ngày — cron sẽ tự log payment kỳ này.
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Giá / chu kỳ</p>
            <p className="text-lg font-semibold">{formatVND(sub.price)}</p>
            <p className="text-xs text-muted-foreground">
              {BILLING_CYCLE_LABELS[sub.billingCycle as BillingCycle] ?? sub.billingCycle}
              {sub.billingCycle === 'CUSTOM' && sub.intervalDays
                ? ` (${sub.intervalDays} ngày)`
                : ''}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Quy đổi mỗi tháng</p>
            <p className="text-lg font-semibold">
              {monthly == null ? '—' : formatVND(monthly)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              <Calendar className="mr-1 inline h-3 w-3" />
              Gia hạn tới
            </p>
            <p className={cn('text-sm font-medium', isOverdue && 'text-red-600')}>
              {isLifetime ? 'Lifetime' : formatDate(renewalDate)}
            </p>
            {!isLifetime && (
              <p className="text-xs text-muted-foreground">
                {daysToRenewal >= 0
                  ? `Còn ${daysToRenewal} ngày`
                  : `Quá ${Math.abs(daysToRenewal)} ngày`}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Đã chi tổng cộng</p>
            <p className="text-lg font-semibold">{formatVND(totalSpent)}</p>
            <p className="text-xs text-muted-foreground">
              qua {sub.payments.length} kỳ
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {sub.manageUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={sub.manageUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Quản lý gói
              </a>
            </Button>
          )}
          {sub.cancelUrl && (
            <Button asChild variant="outline" size="sm">
              <a
                href={sub.cancelUrl}
                target="_blank"
                rel="noreferrer"
                className="!text-rose-600"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Huỷ gói
              </a>
            </Button>
          )}
          {sub.accountEmail && (
            <span className="inline-flex items-center text-sm text-muted-foreground">
              <Mail className="mr-1 h-3 w-3" />
              {sub.accountEmail}
            </span>
          )}
          {sub.paymentMethod && (
            <span className="inline-flex items-center text-sm text-muted-foreground">
              <CreditCard className="mr-1 h-3 w-3" />
              {sub.paymentMethod}
            </span>
          )}
          <span className="inline-flex items-center text-sm text-muted-foreground">
            <RefreshCw className="mr-1 h-3 w-3" />
            {sub.autoRenew ? 'Tự gia hạn' : 'Không tự gia hạn'}
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Lịch sử thanh toán</h3>
          <span className="text-xs text-muted-foreground">
            {sub.payments.length} kỳ
          </span>
        </div>
        <PriceHistoryChart
          data={sub.payments.map((p) => ({
            recordedAt: p.paidAt,
            price: p.amount,
          }))}
        />
        {sub.payments.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {[...sub.payments].reverse().slice(0, 12).map((p) => {
              const paidAt = new Date(p.paidAt);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 text-muted-foreground"
                >
                  <span title={formatDate(paidAt)}>
                    {formatRelativeDay(paidAt)} • {formatDate(paidAt)}
                  </span>
                  <span className="flex-1 truncate text-right">{p.note}</span>
                  <span className="font-medium text-foreground">
                    {formatVND(p.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {sub.notes && (
        <div className="rounded-xl border bg-card p-6">
          <h3 className="mb-3 text-base font-semibold">Ghi chú</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {sub.notes}
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4">
        <p className="mb-3 text-xs text-muted-foreground">Đổi trạng thái nhanh</p>
        <SubscriptionStatusButtons subId={sub.id} status={sub.status} />
      </div>
    </div>
  );
}
