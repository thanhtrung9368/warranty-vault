'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';

export function RetryButton() {
  const t = useT();
  return (
    <Button size="lg" onClick={() => location.reload()}>
      <RefreshCw className="h-4 w-4" />
      {t('Thử lại')}
    </Button>
  );
}
