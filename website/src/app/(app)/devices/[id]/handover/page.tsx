import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HandoverChecklist } from '@/components/handover-checklist';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { categoryLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { tryParseDay } from '@/lib/api-day';

// Reads the device through the same thin proxy as the detail page; the
// checklist is generated locally from fields the API already returns, so no new
// endpoint or server action is involved.
export const dynamic = 'force-dynamic';

export default async function DeviceHandoverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { locale, t } = await getI18n();
  const { id } = await params;

  const res = await api.devices.get(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    throw new Error(res.message ?? t('Không tải được thiết bị'));
  }
  const device = res.data;
  // `Warranty.endDate` is a calendar day (`YYYY-MM-DD`); lexicographic max is
  // the latest end date, and an unreadable row is dropped rather than allowed
  // to become the "latest" date. The checklist is a day-resolution document, so
  // the value is passed as the string — no `new Date()` / `toISOString()`
  // round-trip that could move it a day.
  const warrantyEnd =
    device.warranties
      .map((warranty) => warranty.endDate)
      .filter((end) => tryParseDay(end) !== null)
      .sort()
      .at(-1) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href={`/devices/${device.id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('Quay lại chi tiết')}
          </Link>
        </Button>
        <p className="eyebrow flex items-center gap-1.5">
          <ClipboardCheck className="h-3.5 w-3.5" />
          {t('Checklist bàn giao')}
        </p>
        <h1 className="display mt-1 text-3xl text-ink">
          {t('Chuẩn bị đi bảo hành')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {device.name} • {categoryLabel(device.category, locale)}
          {device.serialNumber ? ` • ${device.serialNumber}` : ''}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('Danh sách sinh riêng cho {name} — tick từng mục khi làm xong.', {
            name: device.name,
          })}
        </p>
      </div>

      {/* `key` resets the tick state if Next reuses this component for another
          device. The list has no persistence by design; carrying ticks across
          devices would be worse than losing them on reload. */}
      <HandoverChecklist
        key={device.id}
        device={{
          name: device.name,
          category: device.category,
          serialNumber: device.serialNumber,
          purchasePlace: device.purchasePlace,
          warrantyEnd,
        }}
      />
    </div>
  );
}
