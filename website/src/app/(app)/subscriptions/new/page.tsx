import Link from 'next/link';
import { ArrowLeft, Heart } from 'lucide-react';
import { SubscriptionForm } from '@/components/subscription-form';
import { Button } from '@/components/ui/button';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';

export default async function NewSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ fromWishlist?: string }>;
}) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const [catalog, fromItemRes] = await Promise.all([
    getDeviceFormCatalog(),
    sp.fromWishlist ? api.wishlist.get(sp.fromWishlist) : Promise.resolve(null),
  ]);
  const fromItem = fromItemRes && fromItemRes.ok ? fromItemRes.data.item : null;

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
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href={fromItem ? `/wishlist/${fromItem.id}` : '/subscriptions'}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {fromItem ? t('Quay lại wishlist') : t('Gói đăng ký')}
          </Link>
        </Button>
        <p className="eyebrow">{t('Thêm mới')}</p>
        <h1 className="display mt-1 text-3xl text-ink">{t('Thêm gói đăng ký')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Apple One, ChatGPT Plus, hosting, domain, streaming...
        </p>
        {fromItem && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-pill bg-rose-soft px-3 py-1.5 text-sm font-semibold text-rose-ink">
            <Heart className="h-4 w-4" />
            {t('Tạo từ wishlist:')}{' '}
            <span className="font-bold">{fromItem.name}</span>
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
