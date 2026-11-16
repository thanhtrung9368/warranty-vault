import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { RemoveSampleDataButton } from '@/components/sample-data-buttons';
import { getI18n } from '@/lib/i18n/server';

// Shown on the dashboard while the account still holds rows created by the
// starter kit's sample-data button. Sample devices are ordinary rows — that is
// the point, they behave like real data — so the only honest way to keep them
// from being mistaken for the user's own inventory is to say so, here, with the
// one-click way to remove them.
export async function SampleDataBanner({ count }: { count: number }) {
  const { t } = await getI18n();

  return (
    <Card
      padding="sm"
      tone="muted"
      className="flex flex-wrap items-center gap-3"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-primary">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-ink">
          {t('Đang xem dữ liệu mẫu')}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('{count} thiết bị mẫu — xoá khi không cần nữa.', { count })}
        </p>
      </div>
      <RemoveSampleDataButton />
    </Card>
  );
}
