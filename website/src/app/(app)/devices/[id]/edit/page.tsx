import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { DeviceForm } from '@/components/device-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { resolveBrandWarrantyLookup } from '@/lib/brand-warranty-lookup';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { getI18n } from '@/lib/i18n/server';
import type { Status } from '@/lib/types';

export default async function EditDevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { t } = await getI18n();
  const { id } = await params;
  const [res, catalog, directoryRes] = await Promise.all([
    api.devices.get(id),
    getDeviceFormCatalog(),
    api.directory.get(id),
  ]);
  if (!res.ok) {
    if (res.status === 404) notFound();
    throw new Error(res.message ?? t('Không tải được thiết bị'));
  }
  const device = res.data;
  // Brand warranty lookup (frozen contract): resolved once on the server for the
  // saved brand. The directory already carries Go's fuzzy-matched brand row, so
  // it is the primary source; the brands endpoint is the fallback when that read
  // failed. The form's brand combobox can change later; that path asks the
  // `lookupBrandWarranty` action on demand. A null URL is shown as "no page".
  const brandLookup = directoryRes.ok
    ? { lookupUrl: directoryRes.data.brand?.warrantyLookupUrl ?? null }
    : await resolveBrandWarrantyLookup(device.brand);

  // `createdAt` arrives as an ISO string from Go — sort lexicographically,
  // which gives the same order as numeric timestamp comparison for ISO 8601.
  const standard = device.warranties
    .filter((w) => w.type === 'STANDARD')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0];

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
        eyebrow={t('Cập nhật')}
        title={t('Sửa thiết bị')}
        description={device.name}
      />
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
          // Multi-currency (frozen contract) — both must round-trip through the
          // edit form: PATCH replaces the whole device, so omitting them would
          // reset a foreign-currency device to VND/null.
          currency: device.currency,
          fxRate: device.fxRate,
          purchasePlace: device.purchasePlace,
          warrantyMonths: standard?.months ?? 0,
          warrantyProvider: standard?.provider ?? null,
          warrantyAddress: standard?.address ?? null,
          warrantyPhone: standard?.phone ?? null,
          warrantyNotes: standard?.notes ?? null,
          status: device.status as Status,
          notes: device.notes,
          // Resale pair — both null until a sale is recorded. `soldAt` arrives
          // in the same Z-less shape as `purchaseDate`; the form converts it
          // for the date input via `soldAtToInputValue`.
          soldAt: device.soldAt,
          soldPrice: device.soldPrice,
          // Return window (migration 0010) — passed through so the form's hidden
          // inputs can send the recorded values back on save. PATCH replaces the
          // whole device, so dropping these would silently erase a window set on
          // another client. The form has no input for them in this pass.
          returnWindowDays: device.returnWindowDays,
          receivedAt: device.receivedAt,
          // Reminder lead days — loaded so the form starts on the saved
          // schedule, and submitted on save by `LeadDaysField`.
          leadDays: device.leadDays,
          // Warranty activation + extended-cover deadline (Feature A) — loaded
          // so the three inputs start on the stored values. The form always
          // submits all three, because PATCH replaces the whole device.
          activationRequired: device.activationRequired,
          activatedAt: device.activatedAt,
          extendedCoverBuyBy: device.extendedCoverBuyBy,
          // Brand warranty answer (the frozen five). Passed so the section starts
          // on the saved values and submits them back: PATCH replaces the whole
          // device, so omitting these would erase a recorded check.
          brandWarrantyStatus: device.brandWarrantyStatus,
          brandWarrantyStart: device.brandWarrantyStart,
          brandWarrantyEnd: device.brandWarrantyEnd,
          brandCheckedAt: device.brandCheckedAt,
          brandLookupUrl: device.brandLookupUrl,
        }}
        brandLookupUrl={brandLookup.lookupUrl}
      />
    </PageShell>
  );
}
