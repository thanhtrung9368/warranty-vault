import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WishlistForm } from '@/components/wishlist-form';
import { Button } from '@/components/ui/button';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { getI18n } from '@/lib/i18n/server';

export default async function NewWishlistPage() {
  const { t } = await getI18n();
  const catalog = await getDeviceFormCatalog();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href="/wishlist">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Wishlist
          </Link>
        </Button>
        <p className="eyebrow">{t('Thêm mới')}</p>
        <h1 className="display mt-1 text-3xl text-ink">{t('Thêm món đang thèm')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Note lại sản phẩm đang để ý — giá, link, ngày dự kiến mua, lý do.')}
        </p>
      </div>
      <WishlistForm
        catalog={{
          categories: catalog.categories,
          brands: catalog.brands,
        }}
      />
    </div>
  );
}
