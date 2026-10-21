import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { WishlistForm } from '@/components/wishlist-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { getI18n } from '@/lib/i18n/server';
import type {
  WishlistPriority,
  WishlistStatus,
} from '@/lib/wishlist-types';
import { parseDay } from '@/lib/api-day';

export default async function EditWishlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t } = await getI18n();
  const [res, catalog] = await Promise.all([
    api.wishlist.get(id),
    getDeviceFormCatalog(),
  ]);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <PageShell className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow={t('Chỉnh sửa')}
          title={t('Sửa món thèm')}
        />
        <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">
          {t('Lỗi tải món: {message}', { message: res.message ?? res.error })}
        </div>
      </PageShell>
    );
  }
  const item = res.data.item;

  return (
    <PageShell className="mx-auto max-w-3xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href={`/wishlist/${item.id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('Quay lại')} {t('chi tiết')}
            </Link>
          </Button>
        }
        eyebrow={t('Chỉnh sửa')}
        title={t('Sửa món thèm')}
        description={item.name}
      />
      <WishlistForm
        catalog={{
          categories: catalog.categories,
          brands: catalog.brands,
        }}
        initial={{
          id: item.id,
          name: item.name,
          category: item.category,
          brand: item.brand,
          initialPrice: item.initialPrice,
          currentPrice: item.currentPrice,
          buyUrl: item.buyUrl,
          imageUrl: item.imageUrl,
          // Calendar day (`YYYY-MM-DD`) → local midnight, not UTC midnight.
          targetDate: item.targetDate ? parseDay(item.targetDate) : null,
          priority: item.priority as WishlistPriority,
          status: item.status as WishlistStatus,
          notes: item.notes,
          reminderIntervalDays: item.reminderIntervalDays,
        }}
      />
    </PageShell>
  );
}
