'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';
import { setReminderEmailFallback } from '@/app/actions/push';

// "Email nhắc hạn" — the reminder email fallback opt-in (#8).
//
// The preference exists because push can die silently (an APNs 410, an FCM
// error, a browser that never granted permission) and the deadline then passes
// unseen. When this is ON and push is unavailable or the fan-out fails, the Go
// cron sends exactly ONE transactional email per reminder to the account
// address. It is not a digest, not a newsletter, and it cannot be sent while
// push is working — that is what makes it safe to leave off by default.
//
// Like the AI opt-in above, the switch is optimistic ONLY for the click: the
// value rendered afterwards is the one the server stored, and a failed save
// reverts with the server's message instead of springing back silently.
export function EmailFallbackSettings({
  initialEnabled,
  email,
}: {
  initialEnabled: boolean;
  email: string;
}) {
  const t = useT();
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !enabled;
    startTransition(async () => {
      const res = await setReminderEmailFallback(next);
      if (res.ok) {
        setEnabled(res.enabled ?? next);
        toast.success(
          next ? t('Đã bật email nhắc hạn') : t('Đã tắt email nhắc hạn'),
        );
      } else {
        // Leave the switch on the value the account really holds.
        toast.error(res.message ?? t('Không cập nhật được cài đặt'));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="icon-badge icon-badge-sm tint-sky mt-0.5">
          <Mail className="h-4 w-4" />
        </span>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-ink">{t('Email nhắc hạn')}</p>
          <p>
            {t(
              'Chỉ dùng khi thông báo đẩy không khả dụng hoặc gửi lỗi: mỗi mốc nhắc gửi tối đa một email, tới địa chỉ {email} của tài khoản. Đây là email giao dịch — không phải email quảng cáo. Mặc định tắt.',
              { email },
            )}
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
