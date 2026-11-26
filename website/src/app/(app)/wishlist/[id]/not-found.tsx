import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getI18n } from '@/lib/i18n/server';

export default async function WishlistItemNotFound() {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <h2 className="text-2xl font-bold">{t('Không tìm thấy món đang thèm')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('Món này không tồn tại hoặc đã bị xoá.')}
      </p>
      <Button asChild className="mt-4">
        <Link href="/wishlist">{t('Quay lại danh sách')}</Link>
      </Button>
    </div>
  );
}
