import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
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
    <PageShell className="mx-auto max-w-5xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href="/devices">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('Danh sách thiết bị')}
            </Link>
          </Button>
        }
        eyebrow={t('Thêm hàng loạt')}
        title={t('Thêm nhiều thiết bị một lúc')}
        description={t(
          'Mỗi dòng một thiết bị. Chỉ cần tên, loại, ngày mua và giá — phần còn lại thêm sau ở trang chi tiết.',
        )}
      />

      <DeviceBulkAdd categories={catalog.categories} />
    </PageShell>
  );
}
