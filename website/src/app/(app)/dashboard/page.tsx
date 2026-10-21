import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import {
  Package,
  ShieldCheck,
  AlertTriangle,
  ShieldX,
  ShieldQuestion,
  ArrowRight,
  Heart,
  Calendar,
  RefreshCw,
  Plus,
  Zap,
  Wrench,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CategoryIconBadge } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { WishlistItem } from '@/lib/api/wishlist';
import type { Subscription } from '@/lib/api/subscriptions';
import {
  monthlySpendTotal,
  SUBSCRIPTION_ACTIVE_STATUSES,
} from '@/lib/subscription-types';
import { WISHLIST_ACTIVE_STATUSES } from '@/lib/wishlist-types';
import { requireUser } from '@/lib/auth';
import { brokenDevicesWithoutOpenClaim } from '@/lib/claims';
import { computeDeviceStats } from '@/lib/device-stats';
import { emptyStateCopy } from '@/lib/empty-state';
import { isColdStartAccount } from '@/lib/first-run';
import { categoryLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { formatDate, formatVND } from '@/lib/format';
import { parseDay, todayDay } from '@/lib/api-day';
import { formatMoney } from '@/lib/currency';
import { cn } from '@/lib/utils';

// Local helpers — replaced the DB-side `wishlistTotals()` /
// `subscriptionTotals()` that went away with the Prisma layer in Phase F.
// We pull the lists from the Go API and crunch the numbers on the RSC.
// Volumes are tiny (≤200 wishlist, ≤100 subs per user).

type WishlistTotals = {
  count: number;
  totalPrice: number;
  upcoming: Array<Pick<WishlistItem, 'id' | 'name' | 'targetDate'>>;
};

function computeWishlistTotals(items: WishlistItem[]): WishlistTotals {
  const active = items.filter((i) =>
    (WISHLIST_ACTIVE_STATUSES as readonly string[]).includes(i.status),
  );
  const totalPrice = active.reduce(
    (sum, i) => sum + (i.currentPrice ?? i.initialPrice ?? 0),
    0,
  );
  const upcoming = active
    .filter((i) => i.targetDate)
    .sort(
      (a, b) =>
        parseDay(a.targetDate ?? todayDay()).getTime() -
        parseDay(b.targetDate ?? todayDay()).getTime(),
    )
    .slice(0, 3)
    .map((i) => ({ id: i.id, name: i.name, targetDate: i.targetDate }));
  return { count: active.length, totalPrice, upcoming };
}

type SubscriptionTotals = {
  count: number;
  monthly: number;
  yearly: number;
  upcoming: Array<Pick<Subscription, 'id' | 'name' | 'renewalDate' | 'price'>>;
};

function computeSubscriptionTotals(subs: Subscription[]): SubscriptionTotals {
  // "gói đang hoạt động" = ACTIVE + PAUSED: how many rows we present as live.
  const active = subs.filter((s) =>
    (SUBSCRIPTION_ACTIVE_STATUSES as readonly string[]).includes(s.status),
  );
  // The money figure is ACTIVE-only so it matches `GET /api/v1/stats`
  // (and therefore iOS/Android) for the same account.
  const monthly = monthlySpendTotal(subs);
  const upcoming = active
    .filter((s) => s.status === 'ACTIVE' && s.autoRenew && s.billingCycle !== 'LIFETIME')
    .sort(
      (a, b) =>
        parseDay(a.renewalDate).getTime() - parseDay(b.renewalDate).getTime(),
    )
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, renewalDate: s.renewalDate, price: s.price }));
  return { count: active.length, monthly, yearly: monthly * 12, upcoming };
}

export const dynamic = 'force-dynamic';

type Tint = 'primary' | 'emerald' | 'amber' | 'zinc' | 'sky' | 'rose';
type StatCardProps = {
  label: string;
  value: number | string;
  icon: LucideIcon;
  sub: string;
  tone: Tint;
};

function StatCard({ label, value, icon: Icon, sub, tone }: StatCardProps) {
  return (
    <Card padding="md" className="stat-card">
      <div className="stat-icon">
        <span className={cn('icon-badge', `tint-${tone}`)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="stat-eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </Card>
  );
}

// `title` arrives already translated from the page; the "view all" affordance is
// this component's own copy, so it resolves the translator itself rather than
// taking a second prop. An async RSC — no hook needed, and `getI18n()` is
// `cache()`d per request, so the three call sites below cost nothing extra.
async function SectionCard({
  icon: Icon,
  tint,
  title,
  href,
  children,
}: {
  icon: LucideIcon;
  tint: Tint;
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  const { t } = await getI18n();
  return (
    <Card padding="md">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn('icon-badge icon-badge-sm', `tint-${tint}`)}>
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="font-display text-lg font-bold tracking-tight">
            {title}
          </h3>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-8 px-3 text-primary">
          <Link href={href}>
            {t('Xem tất cả')}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      {children}
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const [devicesRes, wishlistRes, subsRes, claimsRes] = await Promise.all([
    api.devices.list(),
    api.wishlist.list({ status: 'ALL' }),
    api.subscriptions.list({ status: 'ALL' }),
    // One extra read powers the "broken but no repair case" nudge below. A
    // failed read leaves the nudge out instead of breaking the dashboard.
    api.claims.list(),
  ]);
  const devices = devicesRes.ok ? devicesRes.data : [];
  const stats = computeDeviceStats(devices);
  const wishlistItems = wishlistRes.ok ? wishlistRes.data.items : [];
  const subscriptionRows = subsRes.ok ? subsRes.data.subscriptions : [];
  const wishlist = computeWishlistTotals(wishlistItems);
  const subs = computeSubscriptionTotals(subscriptionRows);
  // A brand-new account gets ONE first-run panel instead of four zero tiles,
  // a green "all good" tick and a quick-add card. The greeting above stays: it
  // is the only place the app says hello.
  //
  // All three lists must have loaded: a failed read is not evidence that the
  // account is empty, and telling a user with data "you have nothing" is worse
  // than showing the normal dashboard (which reports its own errors).
  const coldStart =
    devicesRes.ok &&
    wishlistRes.ok &&
    subsRes.ok &&
    isColdStartAccount({
      devices: devices.length,
      subscriptions: subscriptionRows.length,
      wishlist: wishlistItems.length,
    });
  // Raw rows, not `stats.total`: a sold device is data the app can talk about,
  // so it must not trigger the "no devices yet" copy. `stats.total` remains the
  // right denominator for the warranty buckets.
  const hasDevices = devices.length > 0;
  const noDataCopy = emptyStateCopy('no-data');
  // The dead end this feature removes, surfaced ONCE on the dashboard: a device
  // marked BROKEN with no OPEN/IN_REPAIR case. Non-BROKEN devices are never
  // returned, so this cannot become a wall of alerts.
  const brokenWithoutClaim = brokenDevicesWithoutOpenClaim(
    devices,
    claimsRes.ok ? claimsRes.data : [],
  );

  // Five mutually exclusive buckets over active (non-SOLD) devices. The sum is
  // `stats.total` by construction — see `lib/device-stats.ts`; a sold device is
  // history, not part of the warranty picture.
  const cards: StatCardProps[] = [
    {
      label: t('Tổng thiết bị'),
      value: stats.total,
      icon: Package,
      sub: t('Đang theo dõi'),
      tone: 'primary',
    },
    {
      label: t('Còn bảo hành'),
      value: stats.covered,
      icon: ShieldCheck,
      sub: t('Còn được bảo vệ'),
      tone: 'emerald',
    },
    {
      label: t('Sắp hết (≤30 ngày)'),
      value: stats.expiring,
      icon: AlertTriangle,
      sub: t('Cần để ý nha'),
      tone: 'amber',
    },
    {
      label: t('Đã hết bảo hành'),
      value: stats.expired,
      icon: ShieldX,
      sub: t('Hết kèo rồi'),
      tone: 'zinc',
    },
    {
      label: t('Chưa ghi bảo hành'),
      value: stats.noWarranty,
      icon: ShieldQuestion,
      sub: t('Thiếu ngày hết hạn'),
      tone: 'sky',
    },
  ];

  return (
    <PageShell>
      {/* Hero greeting. It now shares the PageHeader shape (and eyebrow) with
          every other top-level page; it used to be its own smaller, 34px stack. */}
      <PageHeader
        eyebrow={t('Tổng quan')}
        title={
          <>
            {t('Chào')}
            {user.name ? `, ${user.name}` : ''}{' '}
            <span style={{ fontFamily: 'system-ui' }}>👋</span>
          </>
        }
        description={t('Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay.')}
      />

      {/* First run: one panel that explains the loop, instead of a wall of
          zeroes and a green tick congratulating an account we know nothing
          about. Three ways in, in the order a new user actually has them:
          buying now, already holding the receipt, already holding a list. */}
      {coldStart ? (
        <Card padding="md" tone="gradient">
          <div className="flex items-start gap-4">
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card text-primary sm:flex">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="display text-2xl text-ink md:text-3xl">
                {t('Bắt đầu với một thiết bị')}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-ink-2 md:text-base">
                {t(
                  'Thêm thiết bị kèm ngày hết bảo hành — Warrly nhắc bạn trước 30 và 7 ngày và giữ hoá đơn ở cùng một chỗ.',
                )}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button asChild size="lg" className="rounded-pill">
              <Link href="/devices/new">
                <Plus className="mr-1.5 h-4 w-4" />
                {t('Thêm thiết bị')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-pill bg-card">
              <Link href="/inbox">
                <Receipt className="mr-1.5 h-4 w-4" />
                {t('Tôi đã có hoá đơn')}
              </Link>
            </Button>
            <Link
              href="/devices/import"
              className="text-sm font-semibold text-primary underline underline-offset-2 hover:text-primary-ink"
            >
              {t('Có sẵn bảng tính?')}
            </Link>
          </div>
        </Card>
      ) : (
        <>
      {/* Stat cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      {/* The "Hỏng" dead end, nudged once and only when it is real: a device
          marked BROKEN with no OPEN/IN_REPAIR case. Capped to four shortcuts
          plus a link to the broken-device filter; it never becomes a list of
          every alert in the account. */}
      {brokenWithoutClaim.length > 0 && (
        <Card padding="md" tone="warning">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-amber-ink">
              <Wrench className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-bold tracking-tight text-amber-ink">
                {t('{count} thiết bị đang hỏng mà chưa có phiếu sửa chữa.', {
                  count: brokenWithoutClaim.length,
                })}
              </h2>
              <p className="mt-0.5 text-sm text-amber-ink/85">
                {t('Tạo phiếu để ghi lại nơi sửa, số phiếu và chi phí.')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {brokenWithoutClaim.slice(0, 4).map((device) => (
                  <Link
                    key={device.id}
                    href={`/devices/${device.id}#claims`}
                    className="inline-flex max-w-full items-center gap-2 rounded-pill border-[1.5px] border-amber-ink/25 bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-2"
                  >
                    <CategoryIconBadge category={device.category} size="sm" />
                    <span className="truncate">{device.name}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
                {brokenWithoutClaim.length > 4 && (
                  <span className="inline-flex items-center px-1 text-xs font-semibold text-amber-ink">
                    {t('và {count} thiết bị khác', {
                      count: brokenWithoutClaim.length - 4,
                    })}
                  </span>
                )}
                <Link
                  href="/devices?status=BROKEN"
                  className="inline-flex items-center gap-1 rounded-pill px-2 py-1.5 text-xs font-bold text-amber-ink underline underline-offset-2"
                >
                  {t('Xem thiết bị đang hỏng')}
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Main grid — section cards. `grid-cols-1` is not cosmetic: without an
          explicit single-column track the implicit `auto` column sizes to the
          widest card's min-content, which on a 390px phone is the warranty
          row's truncated text + pill (430px) — the whole page then overflows
          horizontally and the top bar/section cards are clipped. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Sắp hết bảo hành */}
        <SectionCard
          icon={AlertTriangle}
          tint="amber"
          title={t('Sắp hết bảo hành')}
          href="/reminders"
        >
          {!hasDevices ? (
            <div className="py-2 text-sm text-muted-foreground">
              <p>{t(noDataCopy.description)}</p>
              <Link
                href={noDataCopy.ctaHref}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                {t(noDataCopy.ctaLabel)}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : stats.soonList.length === 0 ? (
            <div className="py-3 text-sm text-muted-foreground">
              <span className="text-emerald-ink">✓</span>{' '}
              {t('Tất cả đều ngon, không có gì sắp hết trong 30 ngày tới đâu.')}
            </div>
          ) : (
            <ul className="flex flex-col">
              {stats.soonList.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/devices/${d.id}`}
                    className="info-row -mx-2 items-center gap-3 rounded-md px-2 transition-colors hover:bg-secondary"
                  >
                    <CategoryIconBadge category={d.category} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {d.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {categoryLabel(d.category, locale)}
                        {d.brand ? ` • ${d.brand}` : ''} •{' '}
                        {formatDate(d.purchaseDate, locale)}
                        {' • '}
                        {formatMoney(d.purchasePrice, d.currency, locale)}
                        {d.currency !== 'VND' && d.purchasePriceVnd != null && (
                          <span className="text-muted-foreground">
                            {' · ≈ '}
                            {formatVND(d.purchasePriceVnd, locale)}
                          </span>
                        )}
                      </div>
                    </div>
                    <WarrantyPill warrantyEnd={d.effectiveWarrantyEnd} variant="badge" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Subscriptions */}
        {subs.count > 0 && (
          <SectionCard
            icon={RefreshCw}
            tint="sky"
            title={t('Gói đăng ký')}
            href="/subscriptions"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="stat-eyebrow">{t('Mỗi tháng')}</div>
                <div className="font-display text-2xl font-extrabold leading-tight tracking-tight">
                  {formatVND(subs.monthly, locale)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('~ {amount} / năm • {count} gói đang hoạt động', {
                    amount: formatVND(subs.yearly, locale),
                    count: subs.count,
                  })}
                </div>
              </div>
              <div className="min-w-0">
                <div className="stat-eyebrow mb-1.5">{t('Sắp gia hạn')}</div>
                {subs.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('Không có gói nào sắp charge')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {subs.upcoming.slice(0, 4).map((u) => (
                      <li key={u.id}>
                        <Link
                          href={`/subscriptions/${u.id}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-semibold text-ink-2">
                            {formatDate(u.renewalDate, locale)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {u.name}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatVND(u.price, locale)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Wishlist */}
        {wishlist.count > 0 && (
          <SectionCard icon={Heart} tint="rose" title={t('Đang thèm')} href="/wishlist">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="stat-eyebrow">{t('Tổng tiền (giá hiện tại)')}</div>
                <div className="font-display text-2xl font-extrabold leading-tight tracking-tight">
                  {formatVND(wishlist.totalPrice, locale)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('{count} món đang theo dõi', { count: wishlist.count })}
                </div>
              </div>
              <div className="min-w-0">
                <div className="stat-eyebrow mb-1.5">{t('Sắp tới ngày mua')}</div>
                {wishlist.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('Chưa có món nào đặt ngày dự kiến')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {wishlist.upcoming.map((u) => (
                      <li key={u.id}>
                        <Link
                          href={`/wishlist/${u.id}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-semibold text-ink-2">
                            {u.targetDate ? formatDate(u.targetDate, locale) : ''}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {u.name}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Quick add — chunky playful card */}
        <Card padding="md" tone="accent">
          <div className="mb-3 flex items-center gap-2.5">
            <Zap className="h-5 w-5 text-primary-ink" />
            <h3 className="font-display text-lg font-extrabold tracking-tight text-primary-ink">
              {t('Thêm nhanh')}
            </h3>
          </div>
          <p className="mb-4 text-sm text-primary-ink/85">
            {t('Mới mua đồ? Note ngay vào kẻo lại quên.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="h-9">
              <Link href="/devices/new">
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('Thiết bị')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 bg-card">
              <Link href="/subscriptions/new">
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {t('Gói đăng ký')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 bg-card">
              <Link href="/wishlist/new">
                <Heart className="mr-1 h-3.5 w-3.5" />
                Wishlist
              </Link>
            </Button>
          </div>
        </Card>
      </div>
        </>
      )}

      {/* The "has subscriptions or a wishlist, but no devices yet" case. The
          first-run panel is only for an account with literally nothing; this
          account has used the app, so it keeps the normal dashboard plus this
          first-step card. `no-data`, not a green tick: there is still no device
          for the warranty picture to be about. */}
      {!coldStart && !hasDevices && (
        <EmptyState
          emptyReason="no-data"
          title={t('Chưa có thiết bị nào, bắt đầu nào')}
          description={t(
            'Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... để theo dõi bảo hành tự động.',
          )}
        />
      )}
    </PageShell>
  );
}
