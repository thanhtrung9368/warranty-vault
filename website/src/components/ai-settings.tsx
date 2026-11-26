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
          <div className="space-y-3">
            <p>{t('Khi bật, trợ lý AI làm ba việc:')}</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                {t('Đọc ảnh/PDF hoá đơn hoặc thẻ bảo hành để tự điền thông tin. File đã giải mã được gửi tới Anthropic, dịch vụ AI ở Mỹ (ngoài Việt Nam).')}
              </li>
              <li>
                {t('Đọc chín điều khoản hợp đồng từ thẻ bảo hành.')}
              </li>
              <li>
                {t('Đánh giá một lần sửa chữa có thuộc diện bảo hành không và soạn đơn gửi trung tâm. Nội dung phiếu sửa chữa, thông tin thiết bị và điều khoản hợp đồng cũng được gửi tới Anthropic.')}
              </li>
            </ol>
            <p>
              {t('Anthropic tự động xoá đầu vào/đầu ra trong vòng 30 ngày (trừ khi pháp luật hoặc chính sách của họ yêu cầu giữ lâu hơn) và mặc định không dùng dữ liệu API để huấn luyện.')}
            </p>
            <p>
              {t('Phía Warrly, ảnh/PDF vẫn được mã hoá; chỉ văn bản đọc được lưu dạng plaintext trong cơ sở dữ liệu để tìm kiếm.')}
            </p>
            <p>
              {t('Mọi kết quả chỉ là gợi ý hoặc bản nháp để bạn kiểm tra lại, không phải quyết định. Mặc định tắt.')}
            </p>
          </div>
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
