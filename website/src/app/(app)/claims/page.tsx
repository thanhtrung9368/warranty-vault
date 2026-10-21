import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  MapPin,
  Ticket,
  Wallet,
  Wrench,
} from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { ClaimAssessmentPanel } from '@/components/claim-assessment';
import { api } from '@/lib/api';
import type { Claim } from '@/lib/api/claims';
import type { DeviceListItem } from '@/lib/api/devices';
import {
  CLAIM_STATUSES,
  CLAIM_STATUS_TONE,
  claimCoverageLabel,
  claimIsOpen,
  claimStatusLabel,
  formatClaimCost,
  isClaimStatus,
  sortClaimsForDisplay,
  type ClaimStatus,
} from '@/lib/claims';
import { requireUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import type { Translator } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// ── Why this page exists ────────────────────────────────────────────────────
//
// The device card is the anchor (a claim belongs to a device). This page is the
// one question the device card cannot answer: "what is at the shop right
// now?", across every device. It is deliberately a READ view — creation and
// editing stay on the device page, where the device, its warranties and its
// history are all already on screen. No second, subtly different form.
//
// The API's `?status=` filter is the only state; the chips are plain links so
// the page works without JavaScript and the filter is in the URL.

type FilterValue = ClaimStatus | 'ALL';

const FILTERS: readonly FilterValue[] = ['ALL', ...CLAIM_STATUSES];

function filterHref(value: FilterValue): string {
  return value === 'ALL' ? '/claims' : `/claims?status=${value}`;
}

function ClaimRow({
  claim,
  device,
  locale,
  t,
}: {
  claim: Claim;
  device: DeviceListItem | undefined;
  locale: Locale;
  t: Translator;
}) {
  const costLabel = formatClaimCost(claim.cost, locale);
  return (
    <li>
      <div className="rounded-2xl border-[1.5px] border-border bg-card">
        <Link
          href={`/devices/${claim.deviceId}#claim-${claim.id}`}
          className="block rounded-t-2xl p-4 transition-colors hover:bg-surface-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">
                {device?.name ?? claim.deviceId}
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{claim.issue}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-bold',
                  CLAIM_STATUS_TONE[claim.status] ?? 'bg-zinc-soft text-ink-2',
                )}
              >
                {claimStatusLabel(claim.status, locale)}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {t('Mở ngày {date}', {
                date: formatDate(claim.openedAt, locale),
              })}
            </span>
            {claim.expectedReturnAt && !claim.closedAt && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-ink">
                <CalendarClock className="h-3.5 w-3.5" />
                {t('Dự kiến trả {date}', {
                  date: formatDate(claim.expectedReturnAt, locale),
                })}
              </span>
            )}
            {claim.closedAt && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                {t('Đã đóng {date}', {
                  date: formatDate(claim.closedAt, locale),
                })}
              </span>
            )}
            {claim.ticketNumber && (
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-ink-2">
                <Ticket className="h-3.5 w-3.5" />
                {claim.ticketNumber}
              </span>
            )}
            {claim.serviceCenter && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {claim.serviceCenter}
              </span>
            )}
            {costLabel && (
              <span className="inline-flex items-center gap-1">
                <Wallet className="h-3.5 w-3.5" />
                {costLabel}
              </span>
            )}
            <span>{claimCoverageLabel(claim.coveredByWarranty, locale)}</span>
          </div>
        </Link>

        {/* The same advice panel as the device card, on the cross-device list:
            a claim listed here is a claim the user may be about to take to the
            counter, so it must not require a detour to the device page. It is
            outside the link so the button is not nested interactive content. */}
        <div className="border-t border-dashed border-border px-4 py-3">
          <ClaimAssessmentPanel
            claimId={claim.id}
            deviceId={claim.deviceId}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * Cross-device repair list.
 *
 * Unknown statuses (a newer server) fall into the "finished" group by
 * `!claimIsOpen`, so their rows are never silently dropped from the page.
 */
export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireUser();
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const selected: FilterValue = isClaimStatus(sp.status) ? sp.status : 'ALL';

  const [claimsRes, devicesRes] = await Promise.all([
    api.claims.list(selected === 'ALL' ? undefined : { status: selected }),
    // The claim wire shape carries only `deviceId`; the list is the cheapest
    // way to resolve names without an N+1 fetch per claim.
    api.devices.list({ sort: 'name', dir: 'asc' }),
  ]);

  const claims = claimsRes.ok ? sortClaimsForDisplay(claimsRes.data) : [];
  const devices = devicesRes.ok ? devicesRes.data : [];
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  // Used only by the empty state: a claim needs a device, so with zero devices
  // the CTA must create one instead of looping back to this same empty list.
  const hasDevices = devices.length > 0;
  const active = claims.filter(claimIsOpen);
  const finished = claims.filter((claim) => !claimIsOpen(claim));

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t('Sửa chữa')}</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">
          {t('Phiếu sửa chữa')}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground md:text-base">
          {t(
            'Theo dõi máy đang ở tiệm, đã xong hay bị từ chối — trên mọi thiết bị.',
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((value) => {
          const isActive = selected === value;
          const label =
            value === 'ALL' ? t('Tất cả') : claimStatusLabel(value, locale);
          return (
            <Link
              key={value}
              href={filterHref(value)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'rounded-pill border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors',
                isActive
                  ? 'border-primary bg-primary-soft text-primary-ink'
                  : 'border-border bg-card text-ink-2 hover:bg-surface-2',
              )}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {!claimsRes.ok && (
        <p
          role="alert"
          className="rounded-xl border border-rose-ink/20 bg-rose-soft px-4 py-3 text-sm font-semibold text-rose-ink"
        >
          {t('Không tải được danh sách phiếu sửa chữa — thử tải lại trang nhé.')}
        </p>
      )}

      {claimsRes.ok && claims.length === 0 && selected !== 'ALL' && (
        <div className="rounded-2xl border-[1.5px] border-dashed border-border-strong bg-card/60 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink">
            {t('Không có phiếu nào ở trạng thái này.')}
          </p>
          <Link
            href="/claims"
            className="mt-2 inline-block text-sm font-semibold text-primary hover:underline"
          >
            {t('Xoá lọc')}
          </Link>
        </div>
      )}

      {claimsRes.ok && claims.length === 0 && selected === 'ALL' && (
        <EmptyState
          icon={Wrench}
          tone="amber"
          title={t('Chưa có phiếu sửa chữa nào')}
          description={t(
            'Khi một thiết bị hỏng, tạo phiếu từ trang thiết bị để ghi lại nơi sửa, số phiếu và chi phí.',
          )}
          ctaHref={hasDevices ? '/devices?status=BROKEN' : '/devices/new'}
          ctaLabel={
            hasDevices
              ? t('Thêm phiếu sửa chữa')
              : t('Thêm thiết bị đầu tiên')
          }
        />
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-ink">
            {t('Đang xử lý ({count})', { count: active.length })}
          </h2>
          <ul className="space-y-3">
            {active.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                device={devicesById.get(claim.deviceId)}
                locale={locale}
                t={t}
              />
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-ink">
            {t('Đã kết thúc ({count})', { count: finished.length })}
          </h2>
          <ul className="space-y-3">
            {finished.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                device={devicesById.get(claim.deviceId)}
                locale={locale}
                t={t}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
