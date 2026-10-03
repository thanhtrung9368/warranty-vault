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
import { WarrantyPill } from '@/components/warranty-pill';
import { WarrantyList } from '@/components/warranty-list';
import { DeleteDeviceButton } from '@/components/delete-device-button';
import { AttachmentGallery } from '@/components/attachment-gallery';
import { AttachmentUploader } from '@/components/attachment-uploader';
import { DeviceWarningsBanner } from '@/components/device-warnings-banner';
import { api } from '@/lib/api';
import { effectiveWarrantyEnd } from '@/lib/warranty';
import { requireUser } from '@/lib/auth';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  type Category,
  type Status,
} from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { hasSaleRecorded, saleProfitLoss } from '@/lib/device-resale';
import { returnDeadlineNote } from '@/lib/device-return-window';
import { readDeviceWarningsFlash } from '@/lib/device-warnings-flash';
import { costPerDay } from '@/lib/stats-rollup';

export const dynamic = 'force-dynamic';

// Soft pill backgrounds keyed off the device status, mirrors the list page.
const STATUS_PILL: Record<Status, string> = {
  ACTIVE: 'bg-emerald-soft text-emerald-ink',
  EXPIRED: 'bg-amber-soft text-amber-ink',
  SOLD: 'bg-sky-soft text-sky-ink',
  BROKEN: 'bg-rose-soft text-rose-ink',
  LOST: 'bg-zinc-soft text-ink-2',
};

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
  const { id } = await params;
  // Serial advisories from the create/update that just happened ("đã lưu, nhưng
  // có vẻ sai"). They are computed at write time only, so the write action passes
  // them here through a short-lived cookie scoped to this device id; empty for a
  // normal page view.
  const deviceWarnings = await readDeviceWarningsFlash(id);
  const res = await api.devices.get(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    throw new Error(res.message ?? 'Không tải được thiết bị');
  }
  const device = res.data;

  const categoryLabel =
    CATEGORY_LABELS[device.category as Category] ?? device.category;
  const status = device.status as Status;
  const statusLabel = STATUS_LABELS[status] ?? device.status;
  const effectiveEnd = effectiveWarrantyEnd(device.warranties);
  // Resale (roadmap #12). The API returns both halves or neither; the
  // profit/loss versus `purchasePrice` is computed client-side on purpose
  // (openapi: "Lãi/lỗ = soldPrice − purchasePrice (client tự tính)").
  const saleRecorded = hasSaleRecorded(device);
  const profitLoss =
    device.soldPrice != null
      ? saleProfitLoss(device.purchasePrice, device.soldPrice)
      : null;
  // Chi phí sở hữu mỗi ngày (FEATURE_IDEAS #7). Pure helper in
  // `@/lib/stats-rollup` — the same function the /stats ranking uses, so the
  // detail figure and the leaderboard can never disagree. `null` only when
  // `purchaseDate` itself is unusable (the card then says so instead of
  // printing a made-up number).
  const perDay = costPerDay(device, device.warranties);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-pill">
          <Link href="/devices">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Danh sách thiết bị
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <CategoryIconBadge category={device.category} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-2xl text-ink md:text-3xl">{device.name}</h1>
              <span
                className={`inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-semibold ${
                  STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2'
                }`}
              >
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {categoryLabel}
              {device.brand ? ` • ${device.brand}` : ''}
              {device.model ? ` • ${device.model}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-pill">
            <Link href={`/devices/${device.id}/edit`}>
              <Pencil className="mr-1 h-4 w-4" />
              Sửa
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
                Mua hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 sm:grid-cols-2">
              <InfoRow
                icon={Calendar}
                label="Ngày mua"
                value={formatDate(device.purchaseDate)}
              />
              <InfoRow
                icon={Wallet}
                label="Giá mua"
                value={formatVND(device.purchasePrice)}
              />
              <InfoRow icon={Store} label="Nơi mua" value={device.purchasePlace} />
              <InfoRow
                icon={Hash}
                label="Serial / IMEI"
                value={device.serialNumber}
              />
              <InfoRow icon={Tag} label="Loại" value={categoryLabel} />
            </CardContent>
          </Card>

          {/* Sale information is rendered only when a sale was actually
              recorded — an unsold device shows no empty money rows. */}
          {saleRecorded && (
            <Card className="rounded-2xl border-[1.5px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HandCoins className="h-5 w-5 text-sky-ink" />
                  Bán lại
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-6 sm:grid-cols-2">
                <InfoRow
                  icon={CalendarCheck}
                  label="Ngày bán"
                  value={device.soldAt ? formatDate(device.soldAt) : null}
                />
                <InfoRow
                  icon={Wallet}
                  label="Giá bán"
                  value={
                    device.soldPrice != null ? formatVND(device.soldPrice) : null
                  }
                />
                {profitLoss && (
                  <InfoRow
                    icon={profitLoss.tone === 'loss' ? TrendingDown : TrendingUp}
                    label="Lãi/lỗ so với giá mua"
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
                          (giá mua {formatVND(device.purchasePrice)})
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
                Tổng quan bảo hành
              </CardTitle>
              {effectiveEnd && (
                <WarrantyPill warrantyEnd={effectiveEnd} variant="badge" />
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {effectiveEnd ? (
                <>
                  <p className="text-sm text-ink-2">
                    Có <span className="font-semibold text-ink">{device.warranties.length}</span>{' '}
                    gói bảo hành. Gói xa nhất hết{' '}
                    <span className="font-semibold text-ink">{formatDate(effectiveEnd)}</span>.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Quản lý chi tiết từng gói ở mục bên dưới.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Thiết bị chưa có gói bảo hành nào.
                </p>
              )}

              {/* Hạn đổi/trả (migration 0010) — the derived deadline the server
                  computed (`COALESCE(receivedAt, purchaseDate) +
                  returnWindowDays ngày`). Read-only on purpose: no client may
                  expose a way to SET a window yet, so this only echoes what is
                  already recorded. Rendered only when the server derived one. */}
              {device.returnDeadline && (
                <p className="border-t border-dashed border-border pt-2 text-sm text-ink-2">
                  Hạn đổi/trả:{' '}
                  <span className="font-semibold text-ink">
                    {formatDate(device.returnDeadline)}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    ({returnDeadlineNote(device.returnDeadline)})
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Chính sách của cửa hàng do bạn ghi lại, không phải quy định pháp luật.
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Gói bảo hành{' '}
                <span className="font-medium text-muted-foreground">
                  ({device.warranties.length}/5)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WarrantyList
                deviceId={device.id}
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
                }))}
              />
            </CardContent>
          </Card>

          {device.notes && (
            <Card className="rounded-2xl border-[1.5px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <StickyNote className="h-5 w-5 text-muted-foreground" />
                  Ghi chú
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
                Chi phí sử dụng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {perDay == null ? (
                <p className="text-muted-foreground">
                  Thiết bị chưa có ngày mua hợp lệ nên chưa tính được chi phí mỗi ngày.
                </p>
              ) : (
                <>
                  <div>
                    <p className="flex items-baseline gap-1.5">
                      <span className="display text-2xl tabular-nums text-ink">
                        {formatVND(perDay.perDay)}
                      </span>
                      <span className="text-muted-foreground">/ngày</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {perDay.endedBySale ? 'Chi phí thực trả' : 'Tính đến hôm nay'} ·{' '}
                      {perDay.days} ngày
                      {perDay.endedBySale
                        ? ` (${perDay.fromDayLabel} → ${perDay.toDayLabel})`
                        : ` kể từ ${perDay.fromDayLabel}`}
                    </p>
                  </div>

                  <div className="space-y-1 border-t border-dashed border-border pt-2 text-xs text-ink-2">
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Giá mua</span>
                      <span className="tabular-nums">{formatVND(perDay.purchasePart)}</span>
                    </p>
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Gói bảo hành ({perDay.warrantyCount})
                      </span>
                      <span className="tabular-nums">{formatVND(perDay.warrantyPart)}</span>
                    </p>
                    {perDay.soldPart > 0 && (
                      <p className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Tiền bán</span>
                        <span className="tabular-nums">−{formatVND(perDay.soldPart)}</span>
                      </p>
                    )}
                    <p className="flex items-center justify-between gap-2 border-t border-dashed border-border pt-1 font-semibold text-ink">
                      <span>Tổng chi</span>
                      <span className="tabular-nums">{formatVND(perDay.net)}</span>
                    </p>
                  </div>

                  {(perDay.hasUnrecordedWarrantyCost ||
                    perDay.soldBeforePurchase ||
                    perDay.hasUndatedSale ||
                    perDay.fullyRecovered ||
                    perDay.hasNoRecordedCost) && (
                    <ul className="space-y-1 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
                      {perDay.hasNoRecordedCost && (
                        <li>Chưa ghi giá mua và chi phí gói bảo hành nên tạm tính 0 ₫.</li>
                      )}
                      {perDay.hasUnrecordedWarrantyCost && (
                        <li>Có gói bảo hành chưa ghi giá — con số này chỉ là mức tối thiểu.</li>
                      )}
                      {perDay.soldBeforePurchase && (
                        <li>Ngày bán trước ngày mua — dữ liệu có vẻ sai, tạm tính 1 ngày.</li>
                      )}
                      {perDay.hasUndatedSale && (
                        <li>Có giá bán nhưng thiếu ngày bán — tạm tính tới hôm nay.</li>
                      )}
                      {perDay.fullyRecovered && perDay.spent > 0 && (
                        <li>Tiền bán đã thu hồi đủ (hoặc hơn) số đã chi.</li>
                      )}
                    </ul>
                  )}

                  <Link
                    href="/stats#chi-phi-moi-ngay"
                    className="inline-block text-xs font-semibold text-primary hover:underline"
                  >
                    So sánh với các thiết bị khác →
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-[1.5px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-5 w-5 text-primary" />
                File đính kèm{' '}
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
                Thông tin nhanh
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-xs">{device.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Số gói BH</span>
                  <span className="font-semibold">{device.warranties.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">File đính kèm</span>
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
