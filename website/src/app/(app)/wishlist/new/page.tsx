import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WishlistForm } from '@/components/wishlist-form';
import { ListLoadError } from '@/components/list-load-error';
import { Button } from '@/components/ui/button';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { getI18n } from '@/lib/i18n/server';

export default async function NewWishlistPage() {
  const { t } = await getI18n();
  const catalogRes = await getDeviceFormCatalog();
  return (
    <PageShell className="mx-auto max-w-3xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href="/wishlist">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Wishlist
            </Link>
          </Button>
        }
        eyebrow={t('Thêm mới')}
        title={t('Thêm món đang thèm')}
        description={t('Note lại sản phẩm đang để ý — giá, link, ngày dự kiến mua, lý do.')}
      />
      {!catalogRes.ok && (
        <ListLoadError
          message={t('Không tải được danh mục loại thiết bị — tải lại trang rồi thử lại.')}
        />
      )}
      <WishlistForm
        catalog={{
          categories: catalogRes.catalog.categories,
          brands: catalogRes.catalog.brands,
        }}
      />
    </PageShell>
  );
}
