import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DevicePasteImport } from '@/components/device-paste-import';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import { requireUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

// Dán bảng để nhập nhiều thiết bị (FEATURE_IDEAS #13). Read-only until the user
// submits: the preview is rendered client-side by the same pure parser the
// server action re-runs, and the catalog comes from the same source every other
// device form uses (`getDeviceFormCatalog()`), so a pasted "Điện thoại" resolves
// to the same `PHONE` code the combobox would offer.
export default async function ImportDevicesPage() {
  await requireUser();
  const { t } = await getI18n();
  const catalog = await getDeviceFormCatalog();

  return (
    <PageShell className="mx-auto max-w-4xl">
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href="/devices">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('Danh sách thiết bị')}
            </Link>
          </Button>
        }
        eyebrow={t('Nhập nhanh')}
        title={t('Dán bảng để thêm nhiều thiết bị')}
        description={t(
          'Copy một vùng ô từ Excel / Google Sheets (hoặc gõ tay, ngăn cách bằng tab, dấu phẩy hay dấu chấm phẩy) rồi dán vào đây. Xem trước từng dòng trước khi tạo.',
        )}
      />

      <DevicePasteImport categories={catalog.categories} />
    </PageShell>
  );
}
