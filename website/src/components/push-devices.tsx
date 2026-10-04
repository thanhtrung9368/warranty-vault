'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MonitorSmartphone, Smartphone, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { removePushSubscription } from '@/app/actions/push';
import type { PushSubscriptionMeta } from '@/lib/api/push';
import { formatDate } from '@/lib/format';
import { labelOf } from '@/lib/i18n/labels';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

// Source text + catalog keys: the values stay Vietnamese and are resolved
// through `labelOf(…, locale)`. `iPhone / iPad (APNs)` and `Android (FCM)` have
// no entry — they are the same sentence in both languages.
const PLATFORM_LABELS: Record<PushSubscriptionMeta['platform'], string> = {
  web: 'Trình duyệt (Web Push)',
  apns: 'iPhone / iPad (APNs)',
  fcm: 'Android (FCM)',
};

/**
 * The devices (browsers / phones) currently registered to receive push for
 * this account. Backed by `GET /v1/push` and `DELETE /v1/push/{id}` via
 * `app/actions/push.ts` — no push state is kept on the web side.
 */
export function PushDevices({
  subscriptions,
  unavailable = false,
}: {
  subscriptions: PushSubscriptionMeta[];
  unavailable?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const remove = (id: string) => {
    setPendingId(id);
    void (async () => {
      try {
        const res = await removePushSubscription(id);
        if (res.ok) {
          toast.success(t('Đã gỡ thiết bị khỏi danh sách nhận thông báo'));
          router.refresh();
        } else {
          toast.error(res.message ?? t('Không gỡ được thiết bị'));
        }
      } catch {
        toast.error(t('Không gỡ được thiết bị, thử lại sau'));
      } finally {
        setPendingId(null);
      }
    })();
  };

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h3 className="font-display text-[15px] font-bold text-ink">
        {t('Thiết bị nhận thông báo')}
        {!unavailable && subscriptions.length > 0 && (
          <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
            {subscriptions.length}
          </span>
        )}
      </h3>

      {unavailable ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('Không tải được danh sách thiết bị — thử tải lại trang nhé.')}
        </p>
      ) : subscriptions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('Chưa có thiết bị nào đăng ký nhận thông báo. Bật thông báo ở trên để thêm thiết bị này.')}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('Mọi thiết bị dưới đây đều nhận thông báo nhắc bảo hành. Gỡ bớt nếu mày không dùng nữa.')}
          </p>
          <ul className="mt-3">
            {subscriptions.map((s, i) => {
              const Icon = s.platform === 'web' ? MonitorSmartphone : Smartphone;
              const pending = pendingId === s.id;
              const platform = labelOf(PLATFORM_LABELS, s.platform, locale);
              return (
                <li
                  key={s.id}
                  className={cn(
                    'info-row flex items-center gap-3 py-3',
                    i === 0 && '!border-t-0 pt-0',
                  )}
                >
                  <span className="icon-badge icon-badge-sm tint-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-bold text-ink">
                      {platform}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.userAgent ? s.userAgent : t('Không có thông tin thiết bị')} •{' '}
                      {t('Thêm {date}', { date: formatDate(s.createdAt, locale) })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-pill border-border-strong bg-surface-2 text-ink-2 hover:bg-surface-3"
                    disabled={pendingId !== null}
                    aria-label={t('Gỡ {device} khỏi danh sách nhận thông báo', { device: platform })}
                    onClick={() => remove(s.id)}
                  >
                    {pending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <BellOff className="mr-1 h-3.5 w-3.5" />
                    )}
                    {t('Gỡ')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
