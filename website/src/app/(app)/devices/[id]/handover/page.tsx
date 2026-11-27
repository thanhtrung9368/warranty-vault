import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HandoverChecklist } from '@/components/handover-checklist';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { categoryLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { effectiveWarrantyEnd } from '@/lib/warranty';

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
  // The authoritative value: the server's `effectiveWarrantyEnd` (max end date
  // over whole-unit rows only), falling back to the same helper on the local
  // payload. Taking `max(endDate)` over every row would let a component-only
  // warranty ("pin 2 năm") become the device's warranty end on the checklist.
  const warrantyEnd = device.effectiveWarrantyEnd ?? effectiveWarrantyEnd(device.warranties);

  return (
    <PageShell className="mx-auto max-w-3xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href={`/devices/${device.id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('Quay lại chi tiết')}
            </Link>
          </Button>
        }
        eyebrow={
          <span className="flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5" />
            {t('Checklist bàn giao')}
          </span>
        }
        title={t('Chuẩn bị đi bảo hành')}
        description={
          <>
            <span className="block">
              {device.name} • {categoryLabel(device.category, locale)}
              {device.serialNumber ? ` • ${device.serialNumber}` : ''}
            </span>
            <span className="mt-1 block">
              {t('Danh sách sinh riêng cho {name} — tick từng mục khi làm xong.', {
                name: device.name,
              })}
            </span>
          </>
        }
      />

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
    </PageShell>
  );
}
