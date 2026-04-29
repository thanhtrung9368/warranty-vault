import Link from 'next/link';
import { ArrowLeft, Heart } from 'lucide-react';
import { SubscriptionForm } from '@/components/subscription-form';
import { Button } from '@/components/ui/button';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { getWishlistItem } from '@/lib/wishlist';
import { requireUser } from '@/lib/auth';

export default async function NewSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ fromWishlist?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const [catalog, fromItem] = await Promise.all([
    getDeviceFormCatalog(),
    sp.fromWishlist ? getWishlistItem(user.id, sp.fromWishlist) : Promise.resolve(null),
  ]);

  const initial = fromItem
    ? {
        name: fromItem.name,
        category: fromItem.category ?? undefined,
        brand: fromItem.brand,
        price: fromItem.currentPrice ?? fromItem.initialPrice ?? 0,
        notes: fromItem.notes,
        manageUrl: fromItem.buyUrl,
      }
    : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={fromItem ? `/wishlist/${fromItem.id}` : '/subscriptions'}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {fromItem ? 'Quay lại wishlist' : 'Đăng ký'}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Thêm gói đăng ký</h1>
        <p className="text-sm text-muted-foreground">
          Apple One, ChatGPT Plus, hosting, domain, streaming...
        </p>
        {fromItem && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <Heart className="h-4 w-4" />
            Tạo từ wishlist:{' '}
            <span className="font-medium">{fromItem.name}</span>
          </div>
        )}
      </div>
      <SubscriptionForm
        catalog={{
          categories: catalog.categories,
          brands: catalog.brands,
        }}
        initial={initial}
        fromWishlistId={fromItem?.id ?? undefined}
      />
    </div>
  );
}
