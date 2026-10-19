import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeviceBulkAdd } from '@/components/device-bulk-add';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { requireUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

// Bulk add (`POST /api/v1/devices/bulk`). The row editor is the entry shape for
// someone with five new appliances and no table; `devices/import` stays the
// entry point for a pasted order confirmation / spreadsheet.
export default async function BulkAddDevicesPage() {
  await requireUser();
  const { t } = await getI18n();
  const catalog = await getDeviceFormCatalog();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
          <Link href="/devices">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('Danh sách thiết bị')}
          </Link>
        </Button>
        <p className="eyebrow">{t('Thêm hàng loạt')}</p>
        <h1 className="display mt-1 text-3xl text-ink">
          {t('Thêm nhiều thiết bị một lúc')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'Mỗi dòng một thiết bị. Chỉ cần tên, loại, ngày mua và giá — phần còn lại thêm sau ở trang chi tiết.',
          )}
        </p>
      </div>

      <DeviceBulkAdd categories={catalog.categories} />
    </div>
  );
}
