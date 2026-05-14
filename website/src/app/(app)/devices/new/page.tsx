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
  await requireUser();
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
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={fromItem ? `/wishlist/${fromItem.id}` : '/devices'}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {fromItem ? 'Quay lại wishlist' : 'Danh sách thiết bị'}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Thêm thiết bị</h1>
        <p className="text-sm text-muted-foreground">
          Nhập thông tin thiết bị, bảo hành và mua hàng.
        </p>
        {fromItem && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <Heart className="h-4 w-4" />
            Tạo từ wishlist:{' '}
            <span className="font-medium">{fromItem.name}</span>
          </div>
        )}
      </div>
      <DeviceForm
        catalog={catalog}
        initial={initial}
        fromWishlistId={fromItem?.id ?? undefined}
      />
    </div>
  );
}
