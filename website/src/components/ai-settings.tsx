'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';
import { setAIOptIn } from '@/app/actions/ai';

// Toggle for the AI receipt-scan opt-in. Off by default: enabling it means a
// photographed receipt is sent (decrypted) to a third-party AI provider, so we
// make the trade-off explicit rather than silent.
export function AISettings({ initialEnabled }: { initialEnabled: boolean }) {
  const t = useT();
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !enabled;
    startTransition(async () => {
      const res = await setAIOptIn(next);
      if (res.ok) {
        setEnabled(next);
        toast.success(next ? t('Đã bật quét hoá đơn AI') : t('Đã tắt quét hoá đơn AI'));
      } else {
        toast.error(res.message ?? t('Không cập nhật được cài đặt'));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="icon-badge icon-badge-sm tint-primary mt-0.5">
          <ScanLine className="h-4 w-4" />
        </span>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-ink">{t('Quét hoá đơn bằng AI')}</p>
          <p>
            {t('Khi bật, bạn có thể chụp/chọn ảnh (JPEG, PNG, WEBP) hoặc file PDF hoá đơn / phiếu bảo hành để tự điền thông tin thiết bị. File sẽ được gửi (đã giải mã) tới dịch vụ AI bên thứ ba để trích xuất — bạn luôn kiểm tra lại bản nháp trước khi lưu. Mặc định tắt.')}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border-[1.5px] border-border bg-surface-2 px-4 py-3">
        <span className="text-sm font-medium text-ink">
          {enabled ? t('Đang bật') : t('Đang tắt')}
        </span>
        <Button
          type="button"
          variant={enabled ? 'outline' : 'default'}
          className="rounded-pill"
          onClick={toggle}
          disabled={pending}
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {enabled ? t('Tắt') : t('Bật')}
        </Button>
      </div>
    </div>
  );
}
