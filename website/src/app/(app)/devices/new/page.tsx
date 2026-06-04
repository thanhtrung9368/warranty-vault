import Link from 'next/link';
import { ArrowLeft, Heart } from 'lucide-react';
import { DeviceForm } from '@/components/device-form';
import { Button } from '@/components/ui/button';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export default async function NewDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ fromWishlist?: string }>;
}) {
  const sp = await searchParams;
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href={fromItem ? `/wishlist/${fromItem.id}` : '/devices'}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {fromItem ? 'Quay lại wishlist' : 'Danh sách thiết bị'}
          </Link>
        </Button>
        <p className="eyebrow">Thêm vào kho</p>
        <h1 className="display mt-1 text-3xl text-ink">Thêm thiết bị</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nhập thông tin thiết bị, bảo hành và mua hàng.
        </p>
        {fromItem && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-pill border-[1.5px] border-rose-soft bg-rose-soft px-3 py-1.5 text-sm font-semibold text-rose-ink">
            <Heart className="h-4 w-4" />
            Tạo từ wishlist:&nbsp;<span className="font-bold">{fromItem.name}</span>
          </div>
        )}
      </div>
      <DeviceForm
        catalog={catalog}
        initial={initial}
        fromWishlistId={fromItem?.id ?? undefined}
        aiEnabled={user.aiOptIn}
      />
    </div>
  );
}
