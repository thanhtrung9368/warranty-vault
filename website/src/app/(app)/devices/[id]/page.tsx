import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Pencil,
  Calendar,
  Wallet,
  Store,
  ShieldCheck,
  Hash,
  Tag,
  Paperclip,
  StickyNote,
  Info,
  ShoppingBag,
  CalendarCheck,
  HandCoins,
  TrendingDown,
  TrendingUp,
  Coins,
  MapPin,
  Share2,
  Bell,
  ClipboardCheck,
  ArrowRight,
  CalendarClock,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CategoryIconBadge } from '@/components/category-icon';
import { DeviceStatusPill } from '@/components/device-status-pill';
import { WarrantyPill } from '@/components/warranty-pill';
import { WarrantyList } from '@/components/warranty-list';
import { DeleteDeviceButton } from '@/components/delete-device-button';
import { AttachmentGallery } from '@/components/attachment-gallery';
import { AttachmentUploader } from '@/components/attachment-uploader';
import { DeviceWarningsBanner } from '@/components/device-warnings-banner';
import { DeviceShares } from '@/components/device-shares';
import { ServiceDirectoryCard } from '@/components/service-directory-card';
import { ClaimList } from '@/components/claim-list';
import { BrandWarrantyCard } from '@/components/brand-warranty-card';
import { api } from '@/lib/api';
import { effectiveWarrantyEnd } from '@/lib/warranty';
import { requireUser } from '@/lib/auth';
import { brandWarrantyValues } from '@/lib/brand-warranty';
import { resolveBrandWarrantyLookup } from '@/lib/brand-warranty-lookup';
import { categoryLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { type Status } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { formatDayValue } from '@/lib/api-day';
import { formatMoney, needsFxRate } from '@/lib/currency';
import { hasSaleRecorded, saleProfitLoss } from '@/lib/device-resale';
import { returnDeadlineNote } from '@/lib/device-return-window';
import {
  activationStateLabel,
  extendedCoverBuyByNote,
} from '@/lib/device-activation';
import { leadDaysLabel } from '@/lib/lead-days';
import { readDeviceWarningsFlash } from '@/lib/device-warnings-flash';
import { costPerDay } from '@/lib/stats-rollup';
import { buildHandoverChecklist } from '@/lib/handover-checklist';

export const dynamic = 'force-dynamic';

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: React.ReactNode;
  href?: string;
}) {
  if (!value) return null;
  const inner = (
    <div className="info-row">
      <Icon className="info-row-icon h-4 w-4" />
      <div className="min-w-0 flex-1">
        <p className="info-row-label">{label}</p>
        <p className="info-row-value text-sm break-words">{value}</p>
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block hover:underline">
      {inner}
    </a>
  ) : (
    inner
  );
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { locale, t } = await getI18n();
  const { id } = await params;
  // Serial advisories from the create/update that just happened ("đã lưu, nhưng
  // có vẻ sai"). They are computed at write time only, so the write action passes
  // them here through a short-lived cookie scoped to this device id; empty for a
  // normal page view.
  const deviceWarnings = await readDeviceWarningsFlash(id);
  // Three independent reads in one round trip: the device itself (404 decides
  // notFound below), its share links (FEATURE_IDEAS #2) and its warranty
  // directory (FEATURE_IDEAS #15). Both extra reads are allowed to fail without
  // taking the page down — each section says so in its own words.
  const [res, sharesRes, directoryRes] = await Promise.all([
    api.devices.get(id),
    api.shares.list(id),
    api.directory.get(id),
  ]);
  if (!res.ok) {
    if (res.status === 404) notFound();
    throw new Error(res.message ?? t('Không tải được thiết bị'));
  }
  const device = res.data;
  const shares = sharesRes.ok ? sharesRes.data : [];
  const directory = directoryRes.ok ? directoryRes.data : null;
  // Brand warranty lookup (frozen contract). The service directory is already
  // fetched above and its `brand` row carries the same `warrantyLookupUrl`
  // (matched by Go's fuzzy brand rule), so that is the primary source — one fewer
  // round trip and the same match the "đi bảo hành ở đâu" card shows. The
  // dedicated `GET /v1/brands/{brandId}/service-info` resolver is the fallback
  // when the directory read failed. `lookupUrl: null` is a real answer ("we have
  // no page for this brand"), never a reason to fail the page — the card says so.
  const brandLookup = directory
    ? { lookupUrl: directory.brand?.warrantyLookupUrl ?? null }
    : device.brand
      ? await resolveBrandWarrantyLookup(device.brand)
      : { lookupUrl: null };

  const category = categoryLabel(device.category, locale);
  const status = device.status as Status;
  // The chip is shared with `/devices` (`components/device-status-pill.tsx`),
  // so the two pages cannot disagree about how a status looks.
  const effectiveEnd = effectiveWarrantyEnd(device.warranties);
  // Generated from this device's own facts (category, serial, store, warranty
  // end). The detail card only needs the count + section names; the full list
  // lives on the handover route.
  const handoverChecklist = buildHandoverChecklist(
    {
      category: device.category,
      serialNumber: device.serialNumber,
      purchasePlace: device.purchasePlace,
      warrantyEnd: effectiveEnd,
    },
    locale,
  );
  // Resale (roadmap #12). The API returns both halves or neither; the
  // profit/loss versus `purchasePrice` is computed client-side on purpose
  // (openapi: "Lãi/lỗ = soldPrice − purchasePrice (client tự tính)") and is in
  // the DEVICE's currency, not đồng.
  const saleRecorded = hasSaleRecorded(device);
  const profitLoss =
    device.soldPrice != null
      ? saleProfitLoss(
          device.purchasePrice,
          device.soldPrice,
          locale,
          device.currency,
        )
      : null;
  // A foreign-currency device is the case where raw amounts and VND totals
  // differ. Every `…Vnd` figure below comes from the server; the raw amount is
  // only ever formatted with its own currency.
  const isForeignCurrency = needsFxRate(device.currency);
  const purchasePriceLabel = formatMoney(
    device.purchasePrice,
    device.currency,
    locale,
  );
  const soldPriceLabel =
    device.soldPrice != null
      ? formatMoney(device.soldPrice, device.currency, locale)
      : null;
  // Chi phí sở hữu mỗi ngày (FEATURE_IDEAS #7). Pure helper in
  // `@/lib/stats-rollup` — the same function the /stats ranking uses, so the
  // detail figure and the leaderboard can never disagree. `null` only when
  // `purchaseDate` itself is unusable (the card then says so instead of
  // printing a made-up number).
  const perDay = costPerDay(device, device.warranties, locale);

  // Warranty activation + extended-cover deadline (Feature A). `null` when the
  // device neither requires activation nor has a recorded date, so ordinary
  // devices do not grow an empty row. The missing-date state is the one that
  // matters: an unactivated device can be refused at the counter.
  const activationLabel = activationStateLabel(device, locale);
  const activationMissing = Boolean(device.activationRequired) && !device.activatedAt;
  // Countdown for the last day to buy extended cover. `null` only when the
  // recorded value is unparseable — the row still shows the date itself.
  const coverNote = device.extendedCoverBuyBy
    ? extendedCoverBuyByNote(device.extendedCoverBuyBy, locale)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-pill">
          <Link href="/devices">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('Danh sách thiết bị')}
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <CategoryIconBadge category={device.category} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-2xl text-ink md:text-3xl">{device.name}</h1>
              <DeviceStatusPill status={status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {category}
              {device.brand ? ` • ${device.brand}` : ''}
              {device.model ? ` • ${device.model}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-pill">
            <Link href={`/devices/${device.id}/edit`}>
              <Pencil className="mr-1 h-4 w-4" />
              {t('Sửa')}
            </Link>
          </Button>
          <DeleteDeviceButton id={device.id} name={device.name} />
        </div>
      </div>

      {deviceWarnings.length > 0 && <DeviceWarningsBanner warnings={deviceWarnings} />}

      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-6">
          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="h-5 w-5 text-primary" />
                {t('Mua hàng')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 sm:grid-cols-2">
              <InfoRow
                icon={Calendar}
                label={t('Ngày mua')}
                value={formatDate(device.purchaseDate, locale)}
              />
              <InfoRow
                icon={Wallet}
                label={t('Giá mua')}
                value={
                  <>
                    <span>{purchasePriceLabel}</span>
                    {isForeignCurrency && device.purchasePriceVnd != null && (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {t('≈ {amount}', {
                          amount: formatVND(device.purchasePriceVnd, locale),
                        })}
                      </span>
                    )}
                  </>
                }
              />
              {isForeignCurrency && device.fxRate != null && (
                <InfoRow
                  icon={Coins}
                  label={t('Tỷ giá đã khoá')}
                  value={
                    <span className="block">
                      {t('1 {currency} = {rate}', {
                        currency: device.currency,
                        rate: formatVND(device.fxRate, locale),
                      })}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {t(
                          'Tỷ giá được khoá tại thời điểm nhập, không đổi theo thị trường.',
                        )}
                      </span>
                    </span>
                  }
                />
              )}
              <InfoRow icon={Store} label={t('Nơi mua')} value={device.purchasePlace} />
              <InfoRow
                icon={Hash}
                label={t('Serial / IMEI')}
                value={device.serialNumber}
              />
              <InfoRow icon={Tag} label={t('Loại')} value={category} />
            </CardContent>
          </Card>

          {/* Sale information is rendered only when a sale was actually
              recorded — an unsold device shows no empty money rows. */}
          {saleRecorded && (
            <Card className="rounded-2xl border-[1.5px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HandCoins className="h-5 w-5 text-sky-ink" />
                  {t('Bán lại')}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-6 sm:grid-cols-2">
                <InfoRow
                  icon={CalendarCheck}
                  label={t('Ngày bán')}
                  value={device.soldAt ? formatDate(device.soldAt, locale) : null}
                />
                <InfoRow
                  icon={Wallet}
                  label={t('Giá bán')}
                  value={
                    soldPriceLabel != null ? (
                      <>
                        <span>{soldPriceLabel}</span>
                        {isForeignCurrency && device.soldPriceVnd != null && (
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {t('≈ {amount}', {
                              amount: formatVND(device.soldPriceVnd, locale),
                            })}
                          </span>
                        )}
                      </>
                    ) : null
                  }
                />
                {profitLoss && (
                  <InfoRow
                    icon={profitLoss.tone === 'loss' ? TrendingDown : TrendingUp}
                    label={t('Lãi/lỗ so với giá mua')}
                    value={
                      <span
                        className={
                          profitLoss.tone === 'profit'
                            ? 'font-semibold text-emerald-ink'
                            : profitLoss.tone === 'loss'
                              ? 'font-semibold text-destructive'
                              : 'font-semibold text-ink-2'
                        }
                      >
                        {profitLoss.label}
                        <span className="ml-1 font-normal text-muted-foreground">
                          {t('(giá mua {amount})', {
                            amount: purchasePriceLabel,
                          })}
                        </span>
                      </span>
                    }
                  />
                )}
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-5 w-5 text-emerald-ink" />
                {t('Tổng quan bảo hành')}
              </CardTitle>
              {effectiveEnd && (
                <WarrantyPill warrantyEnd={effectiveEnd} variant="badge" />
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {effectiveEnd ? (
                <>
                  <p className="text-sm text-ink-2">
                    {t('Có {count} gói bảo hành. Gói xa nhất hết {date}.', {
                      count: device.warranties.length,
                      date: formatDate(effectiveEnd, locale),
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('Quản lý chi tiết từng gói ở mục bên dưới.')}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('Thiết bị chưa có gói bảo hành nào.')}
                </p>
              )}

              {/* Hạn đổi/trả (migration 0010) — the derived deadline the server
                  computed (`COALESCE(receivedAt, purchaseDate) +
                  returnWindowDays ngày`). Read-only on purpose: no client may
                  expose a way to SET a window yet, so this only echoes what is
                  already recorded. Rendered only when the server derived one. */}
              {device.returnDeadline && (
                <p className="border-t border-dashed border-border pt-2 text-sm text-ink-2">
                  {t('Hạn đổi/trả:')}{' '}
                  <span className="font-semibold text-ink">
                    {formatDayValue(device.returnDeadline, locale)}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    ({returnDeadlineNote(device.returnDeadline, locale)})
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('Chính sách của cửa hàng do bạn ghi lại, không phải quy định pháp luật.')}
                  </span>
                </p>
              )}

              {/* Warranty activation (Feature A). Two states matter: a device
                  with a recorded activation date ("Đã kích hoạt ngày …") and
                  one that requires activation but has none yet ("Chưa kích
                  hoạt" + why that is a problem at the counter). A device with
                  neither setting renders no row at all. */}
              {activationLabel && (
                <div className="border-t border-dashed border-border pt-2 text-sm text-ink-2">
                  <p className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-ink" />
                    <span className="font-semibold text-ink">{activationLabel}</span>
                  </p>
                  {activationMissing && (
                    <p className="mt-0.5 pl-6 text-xs font-medium text-amber-ink">
                      {t('Cửa hàng chưa kích hoạt — máy có thể bị từ chối bảo hành.')}
                    </p>
                  )}
                </div>
              )}

              {/* Extended-cover deadline (Feature A). The date is the record;
                  the parenthetical is the countdown, because this window closes
                  forever and "còn 3 ngày" is the actionable half. */}
              {device.extendedCoverBuyBy && (
                <p className="border-t border-dashed border-border pt-2 text-sm text-ink-2">
                  <span className="inline-flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-ink" />
                    <span>
                      {t('Hạn mua gói mở rộng:')}{' '}
                      <span className="font-semibold text-ink">
                        {formatDate(device.extendedCoverBuyBy, locale)}
                      </span>
                      {coverNote && (
                        <span className="text-muted-foreground"> ({coverNote})</span>
                      )}
                    </span>
                  </span>
                </p>
              )}

              {/* Reminder schedule (per-user `Device.leadDays`). This replaces
                  the old fixed 7/30-day cron text: the sentence is generated
                  from the device's own list, sorted descending by the server
                  (and again by `leadDaysLabel` for safety). */}
              <p className="flex items-start gap-2 border-t border-dashed border-border pt-2 text-sm text-ink-2">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{leadDaysLabel(device.leadDays, locale)}</span>
              </p>
            </CardContent>
          </Card>

          {/* Brand warranty lookup (frozen contract). Placed directly under the
              warranty overview, because it is the section that can REINTERPRET
              "còn hạn": the brand may record a start date months before the
              invoice. The card owns the mismatch explanation, the brand's own
              lookup link (or the honest no-link sentence) and the small record
              form — see `@/components/brand-warranty-card`. */}
          <BrandWarrantyCard
            deviceId={device.id}
            brandName={device.brand}
            lookupUrl={brandLookup.lookupUrl}
            values={brandWarrantyValues(device)}
            mismatch={device.warrantyMismatch}
          />

          {/* Pre-service handover checklist. The card is the entry point; the
              generated list and its tick-boxes live on `/devices/[id]/handover`
              because the full list would bury the rest of this page. */}
          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                {t('Chuẩn bị đi bảo hành')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-ink-2">
                {t(
                  '{count} việc cần kiểm tra trước khi giao máy, từ sao lưu dữ liệu và đăng xuất tài khoản đến hoá đơn, hộp máy và phiếu tiếp nhận.',
                  { count: handoverChecklist.total },
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {handoverChecklist.groups.map((group) => (
                  <span
                    key={group.id}
                    className="rounded-pill bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2"
                  >
                    {group.title}
                  </span>
                ))}
              </div>
              <Button asChild variant="outline" className="rounded-pill">
                <Link href={`/devices/${device.id}/handover`}>
                  {t('Mở checklist bàn giao')}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-5 w-5 text-primary" />
                {t('Gói bảo hành')}{' '}
                <span className="font-medium text-muted-foreground">
                  ({device.warranties.length}/5)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WarrantyList
                deviceId={device.id}
                // `Warranty.cost` is in the device's currency, not đồng.
                currency={device.currency}
                warranties={device.warranties.map((w) => ({
                  id: w.id,
                  type: w.type,
                  provider: w.provider,
                  startDate: w.startDate,
                  endDate: w.endDate,
                  months: w.months,
                  cost: w.cost,
                  address: w.address,
                  phone: w.phone,
                  notes: w.notes,
                  // Contract terms — spread through so the row can render
                  // them and the edit form can prefill them.
                  component: w.component,
                  scope: w.scope,
                  cap: w.cap,
                  deductible: w.deductible,
                  exclusions: w.exclusions,
                  region: w.region,
                  transferable: w.transferable,
                  claimsAllowed: w.claimsAllowed,
                  claimsUsed: w.claimsUsed,
                }))}
              />
            </CardContent>
          </Card>

          {/* Sửa chữa & bảo hành — the anchor surface for claims. A claim
              belongs to a device, so this is where the full lifecycle lives:
              the ticket number, the shop, the diagnosis, the money and the
              tri-state "did the warranty pay". The standalone /claims page is
              only the cross-device "what is at the shop right now" view.

              `id="claims"` is the fallback target of the 409 link when the
              follow-up read could not name the open case; each row carries its
              own `claim-<id>` anchor. */}
          <Card id="claims" className="scroll-mt-24 rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-5 w-5 text-amber-ink" />
                {t('Sửa chữa & bảo hành')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ClaimList
                deviceId={device.id}
                deviceName={device.name}
                deviceStatus={device.status}
                claims={device.claims ?? []}
                warranties={device.warranties.map((w) => ({
                  id: w.id,
                  type: w.type,
                  provider: w.provider,
                  endDate: w.endDate,
                }))}
              />
            </CardContent>
          </Card>

          {/* Danh bạ bảo hành (FEATURE_IDEAS #15): the question actually asked
              at the counter — "giờ tôi mang máy đi đâu". Sits directly under the
              warranty packages because it answers per package, and it is honest
              about what the app does not know (see @/lib/service-directory). */}
          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-5 w-5 text-sky-ink" />
                {t('Đi bảo hành ở đâu')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ServiceDirectoryCard
                directory={directory}
                unavailable={!directoryRes.ok}
              />
            </CardContent>
          </Card>

          {/* Phiếu bàn giao + link chia sẻ (FEATURE_IDEAS #2). The certificate
              itself is an HTML page served by the API on its own origin; this
              section only manages links to it. */}
          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Share2 className="h-5 w-5 text-primary" />
                {t('Phiếu bàn giao & link chia sẻ')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeviceShares
                deviceId={device.id}
                deviceName={device.name}
                shares={shares}
                unavailable={!sharesRes.ok}
              />
            </CardContent>
          </Card>

          {device.notes && (
            <Card className="rounded-2xl border-[1.5px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <StickyNote className="h-5 w-5 text-muted-foreground" />
                  {t('Ghi chú')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
                  {device.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Chi phí sở hữu mỗi ngày (FEATURE_IDEAS #7). Deliberately next to
              the money cards and above the attachment list: it is the one money
              figure on this page that is divided by time, i.e. the only one that
              can answer "món này có đáng tiền không". */}
          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="h-5 w-5 text-amber-ink" />
                {t('Chi phí sử dụng')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {perDay == null ? (
                <p className="text-muted-foreground">
                  {t('Thiết bị chưa có ngày mua hợp lệ nên chưa tính được chi phí mỗi ngày.')}
                </p>
              ) : (
                <>
                  <div>
                    <p className="flex items-baseline gap-1.5">
                      <span className="display text-2xl tabular-nums text-ink">
                        {formatVND(perDay.perDay, locale)}
                      </span>
                      <span className="text-muted-foreground">{t('/ngày')}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {perDay.endedBySale ? t('Chi phí thực trả') : t('Tính đến hôm nay')} ·{' '}
                      {t('{days} ngày', { days: perDay.days, count: perDay.days })}
                      {perDay.endedBySale
                        ? ` (${perDay.fromDayLabel} → ${perDay.toDayLabel})`
                        : ` ${t('kể từ {from}', { from: perDay.fromDayLabel })}`}
                    </p>
                  </div>

                  <div className="space-y-1 border-t border-dashed border-border pt-2 text-xs text-ink-2">
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('Giá mua')}</span>
                      <span className="tabular-nums">{formatVND(perDay.purchasePart, locale)}</span>
                    </p>
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {t('Gói bảo hành ({count})', { count: perDay.warrantyCount })}
                      </span>
                      <span className="tabular-nums">{formatVND(perDay.warrantyPart, locale)}</span>
                    </p>
                    {perDay.soldPart > 0 && (
                      <p className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{t('Tiền bán')}</span>
                        <span className="tabular-nums">−{formatVND(perDay.soldPart, locale)}</span>
                      </p>
                    )}
                    <p className="flex items-center justify-between gap-2 border-t border-dashed border-border pt-1 font-semibold text-ink">
                      <span>{t('Tổng chi')}</span>
                      <span className="tabular-nums">{formatVND(perDay.net, locale)}</span>
                    </p>
                  </div>

                  {(perDay.hasUnrecordedWarrantyCost ||
                    perDay.hasUnconvertedWarrantyCost ||
                    perDay.hasUnknownPurchaseValue ||
                    perDay.soldBeforePurchase ||
                    perDay.hasUndatedSale ||
                    perDay.fullyRecovered ||
                    perDay.hasNoRecordedCost) && (
                    <ul className="space-y-1 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
                      {perDay.hasNoRecordedCost && (
                        <li>{t('Chưa ghi giá mua và chi phí gói bảo hành nên tạm tính 0 ₫.')}</li>
                      )}
                      {perDay.hasUnrecordedWarrantyCost && (
                        <li>{t('Có gói bảo hành chưa ghi giá — con số này chỉ là mức tối thiểu.')}</li>
                      )}
                      {perDay.hasUnconvertedWarrantyCost && (
                        <li>
                          {t(
                            'Có gói bảo hành bằng ngoại tệ chưa được quy đổi — con số này chưa gồm gói đó.',
                          )}
                        </li>
                      )}
                      {perDay.hasUnknownPurchaseValue && (
                        <li>
                          {t(
                            'Thiết bị ngoại tệ này thiếu tỷ giá nên chưa quy được giá mua — con số này chỉ gồm phần đã biết.',
                          )}
                        </li>
                      )}
                      {perDay.soldBeforePurchase && (
                        <li>{t('Ngày bán trước ngày mua — dữ liệu có vẻ sai, tạm tính 1 ngày.')}</li>
                      )}
                      {perDay.hasUndatedSale && (
                        <li>{t('Có giá bán nhưng thiếu ngày bán — tạm tính tới hôm nay.')}</li>
                      )}
                      {perDay.fullyRecovered && perDay.spent > 0 && (
                        <li>{t('Tiền bán đã thu hồi đủ (hoặc hơn) số đã chi.')}</li>
                      )}
                    </ul>
                  )}

                  <Link
                    href="/stats#chi-phi-moi-ngay"
                    className="inline-block text-xs font-semibold text-primary hover:underline"
                  >
                    {t('So sánh với các thiết bị khác →')}
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

          {/* `id="attachments"` is the target of a search hit for a filed
              receipt (`attachmentSearchHref`); scroll-mt keeps it clear of the
              sticky topbar. */}
          <Card id="attachments" className="scroll-mt-24 rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-5 w-5 text-primary" />
                {t('File đính kèm ({count})', { count: device.attachments.length })}{' '}
                <span className="font-medium text-muted-foreground">
                  ({device.attachments.length}/5)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <AttachmentGallery items={device.attachments} />
              <Separator />
              <AttachmentUploader
                deviceId={device.id}
                remaining={5 - device.attachments.length}
              />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-[1.5px] bg-surface-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-5 w-5 text-muted-foreground" />
                {t('Thông tin nhanh')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('ID')}</span>
                  <span className="font-mono text-xs">{device.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('Số gói BH')}</span>
                  <span className="font-semibold">{device.warranties.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('File đính kèm')}</span>
                  <span className="font-semibold">
                    {device.attachments.length}/5
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
