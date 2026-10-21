import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { ArrowLeft, Heart } from 'lucide-react';
import { DeviceForm } from '@/components/device-form';
import { Button } from '@/components/ui/button';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { resolveBrandWarrantyLookup } from '@/lib/brand-warranty-lookup';
import { getI18n } from '@/lib/i18n/server';

export default async function NewDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ fromWishlist?: string }>;
}) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const user = await requireUser();
  const [catalog, fromItem] = await Promise.all([
    getDeviceFormCatalog(),
    sp.fromWishlist
      ? api.wishlist.get(sp.fromWishlist).then((res) => (res.ok ? res.data.item : null))
      : Promise.resolve(null),
  ]);

  // Prefill device form from a wishlist item, if provided + owned by user.
  const initial = fromItem
    ? {
        name: fromItem.name,
        category: fromItem.category ?? undefined,
        brand: fromItem.brand,
        purchasePrice: fromItem.currentPrice ?? fromItem.initialPrice ?? undefined,
        purchasePlace: fromItem.buyUrl ?? undefined,
        notes: fromItem.notes,
      }
    : undefined;

  // A wishlist prefill may already carry a brand; resolve its lookup page so the
  // brand-warranty section shows the link (or the honest no-link sentence) before
  // the first save. Empty brand → no resolution, no extra call.
  const brandLookup = initial?.brand
    ? await resolveBrandWarrantyLookup(initial.brand)
    : { lookupUrl: null };

  return (
    <PageShell className="mx-auto max-w-3xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href={fromItem ? `/wishlist/${fromItem.id}` : '/devices'}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {fromItem ? t('Quay lại wishlist') : t('Danh sách thiết bị')}
            </Link>
          </Button>
        }
        eyebrow={t('Thêm vào kho')}
        title={t('Thêm thiết bị')}
        description={
          <>
            {t('Nhập thông tin thiết bị, bảo hành và mua hàng.')}
            {fromItem && (
              <span className="mt-3 flex w-fit items-center gap-2 rounded-pill border-[1.5px] border-rose-soft bg-rose-soft px-3 py-1.5 text-sm font-semibold text-rose-ink">
                <Heart className="h-4 w-4" />
                {t('Tạo từ wishlist:')}&nbsp;
                <span className="font-bold">{fromItem.name}</span>
              </span>
            )}
          </>
        }
      />
      <DeviceForm
        catalog={catalog}
        initial={initial}
        fromWishlistId={fromItem?.id ?? undefined}
        aiEnabled={user.aiOptIn}
        brandLookupUrl={brandLookup.lookupUrl}
      />
    </PageShell>
  );
}
