import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { WishlistForm } from '@/components/wishlist-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import type {
  WishlistPriority,
  WishlistStatus,
} from '@/lib/wishlist-types';

export default async function EditWishlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await api.wishlist.get(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Lỗi tải món: {res.message ?? res.error}
      </div>
    );
  }
  const item = res.data.item;
  const catalog = await getDeviceFormCatalog();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={`/wishlist/${item.id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Quay lại chi tiết
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Sửa món thèm</h1>
        <p className="text-sm text-muted-foreground">{item.name}</p>
      </div>
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
          targetDate: item.targetDate ? new Date(item.targetDate) : null,
          priority: item.priority as WishlistPriority,
          status: item.status as WishlistStatus,
          notes: item.notes,
          reminderIntervalDays: item.reminderIntervalDays,
        }}
      />
    </div>
  );
}
