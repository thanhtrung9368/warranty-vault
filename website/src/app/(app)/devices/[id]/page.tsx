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
