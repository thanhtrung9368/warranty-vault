import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { DeviceForm } from '@/components/device-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import type { Status } from '@/lib/types';

export default async function EditDevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const [res, catalog] = await Promise.all([
    api.devices.get(id),
    getDeviceFormCatalog(),
  ]);
  if (!res.ok) {
    if (res.status === 404) notFound();
    throw new Error(res.message ?? 'Không tải được thiết bị');
  }
  const device = res.data;

  // `createdAt` arrives as an ISO string from Go — sort lexicographically,
  // which gives the same order as numeric timestamp comparison for ISO 8601.
  const standard = device.warranties
    .filter((w) => w.type === 'STANDARD')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href={`/devices/${device.id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Quay lại chi tiết
          </Link>
        </Button>
        <p className="eyebrow">Cập nhật</p>
        <h1 className="display mt-1 text-3xl text-ink">Sửa thiết bị</h1>
        <p className="mt-1 text-sm text-muted-foreground">{device.name}</p>
      </div>
      <DeviceForm
        catalog={catalog}
        initial={{
          id: device.id,
          name: device.name,
          category: device.category,
          brand: device.brand,
          model: device.model,
          serialNumber: device.serialNumber,
          purchaseDate: device.purchaseDate,
          purchasePrice: device.purchasePrice,
          purchasePlace: device.purchasePlace,
          warrantyMonths: standard?.months ?? 0,
          warrantyProvider: standard?.provider ?? null,
          warrantyAddress: standard?.address ?? null,
          warrantyPhone: standard?.phone ?? null,
          warrantyNotes: standard?.notes ?? null,
          status: device.status as Status,
          notes: device.notes,
        }}
      />
    </div>
  );
}
