import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StaplesBoard } from '@/components/staples-board';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function StaplesPage() {
  const { t } = await getI18n();
  const res = await api.staples.list();

  return (
    <PageShell>
      <PageHeader
        back={
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 rounded-pill">
            <Link href="/wishlist">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('Wishlist')}
            </Link>
          </Button>
        }
        eyebrow={t('Wishlist')}
        title={t('Đồ dùng thiết yếu')}
        description={t('Nhắc mua lại khi sắp hết — theo chu kỳ hoặc thủ công.')}
      />

      {!res.ok ? (
        <Card className="mt-6 flex flex-col items-start gap-3 p-6">
          <h2 className="display text-xl text-ink">{t('Không tải được đồ dùng')}</h2>
          <p className="text-sm text-muted-foreground">
            {res.message ?? res.error}
          </p>
          <Button asChild variant="outline" className="rounded-pill">
            <Link href="/wishlist/staples">{t('Thử lại')}</Link>
          </Button>
        </Card>
      ) : (
        <div className="mt-6">
          <StaplesBoard items={res.data.items} />
        </div>
      )}
    </PageShell>
  );
}
