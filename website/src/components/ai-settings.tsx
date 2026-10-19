'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';
import { setAIOptIn } from '@/app/actions/ai';

// Toggle for the AI opt-in. Off by default: enabling it sends decrypted receipt
// images to a third-party AI provider, and — since gap #7 — also claim and
// warranty-contract text for the coverage assessment. The flag is shared, so the
// copy has to name both uses rather than just the receipt scan it started as.
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
        toast.success(next ? t('Đã bật trợ lý AI') : t('Đã tắt trợ lý AI'));
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
          <p className="font-medium text-ink">{t('Trợ lý AI')}</p>
          <p>
            {t('Khi bật, trợ lý AI làm được hai việc: (1) đọc ảnh/PDF hoá đơn để tự điền thông tin thiết bị — file được gửi đã giải mã tới dịch vụ AI bên thứ ba; (2) đánh giá một lần sửa chữa có thuộc diện bảo hành không và soạn đơn gửi trung tâm — nội dung phiếu sửa chữa, thông tin thiết bị và các điều khoản hợp đồng bảo hành sẽ được gửi tới dịch vụ đó. Cả hai đều chỉ là gợi ý để bạn kiểm tra lại, không phải quyết định. Mặc định tắt.')}
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
