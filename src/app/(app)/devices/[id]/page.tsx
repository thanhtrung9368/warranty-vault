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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CategoryIcon } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { WarrantyList } from '@/components/warranty-list';
import { DeleteDeviceButton } from '@/components/delete-device-button';
import { AttachmentGallery } from '@/components/attachment-gallery';
import { AttachmentUploader } from '@/components/attachment-uploader';
import { getDevice } from '@/lib/devices';
import { effectiveWarrantyEnd } from '@/lib/warranty';
import { requireUser } from '@/lib/auth';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
  type Category,
  type Status,
} from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value}</p>
      </div>
    </div>
  );
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const device = await getDevice(user.id, id);
  if (!device) notFound();

  const categoryLabel =
    CATEGORY_LABELS[device.category as Category] ?? device.category;
  const statusLabel = STATUS_LABELS[device.status as Status] ?? device.status;
  const effectiveEnd = effectiveWarrantyEnd(device.warranties);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/devices">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Danh sách thiết bị
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <CategoryIcon category={device.category} className="h-7 w-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{device.name}</h1>
              <Badge
                variant="outline"
                className={cn('border-transparent', STATUS_COLORS[device.status as Status])}
              >
                {statusLabel}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {categoryLabel}
              {device.brand ? ` • ${device.brand}` : ''}
              {device.model ? ` • ${device.model}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/devices/${device.id}/edit`}>
              <Pencil className="mr-1 h-4 w-4" />
              Sửa
            </Link>
          </Button>
          <DeleteDeviceButton id={device.id} name={device.name} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mua hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow icon={Calendar} label="Ngày mua" value={formatDate(device.purchaseDate)} />
            <InfoRow icon={Wallet} label="Giá mua" value={formatVND(device.purchasePrice)} />
            <InfoRow icon={Store} label="Nơi mua" value={device.purchasePlace} />
            <InfoRow icon={Hash} label="Serial / IMEI" value={device.serialNumber} />
            <InfoRow icon={Tag} label="Loại" value={categoryLabel} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Tổng quan bảo hành
            </CardTitle>
            {effectiveEnd && <WarrantyPill warrantyEnd={effectiveEnd} variant="badge" />}
          </CardHeader>
          <CardContent className="space-y-2">
            {effectiveEnd ? (
              <>
                <p className="text-sm">
                  Có <span className="font-semibold">{device.warranties.length}</span> gói
                  bảo hành. Gói xa nhất hết{' '}
                  <span className="font-semibold">{formatDate(effectiveEnd)}</span>.
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Gói bảo hành ({device.warranties.length}/5)
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ghi chú</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{device.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Paperclip className="h-5 w-5" />
            File đính kèm ({device.attachments.length}/5)
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
    </div>
  );
}
