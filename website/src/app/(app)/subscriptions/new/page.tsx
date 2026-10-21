import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
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
    <PageShell className="mx-auto max-w-3xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href={fromItem ? `/wishlist/${fromItem.id}` : '/subscriptions'}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {fromItem ? t('Quay lại wishlist') : t('Gói đăng ký')}
            </Link>
          </Button>
        }
        eyebrow={t('Thêm mới')}
        title={t('Thêm gói đăng ký')}
        description={
          <>
            Apple One, ChatGPT Plus, hosting, domain, streaming...
            {fromItem && (
              <span className="mt-3 flex w-fit items-center gap-2 rounded-pill bg-rose-soft px-3 py-1.5 text-sm font-semibold text-rose-ink">
                <Heart className="h-4 w-4" />
                {t('Tạo từ wishlist:')}{' '}
                <span className="font-bold">{fromItem.name}</span>
              </span>
            )}
          </>
        }
      />
      <SubscriptionForm
        catalog={{
          categories: catalog.categories,
          brands: catalog.brands,
        }}
        initial={initial}
      />
    </PageShell>
  );
}
