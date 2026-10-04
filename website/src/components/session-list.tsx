'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MonitorSmartphone, Smartphone, ShieldOff, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { revokeMySession } from '@/app/actions/sessions';
import type { SessionSummary } from '@/lib/api/auth';
import {
  sessionDeviceLabel,
  sessionPlatformLabel,
} from '@/lib/sessions';
import { formatDate, formatRelativeDay } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/**
 * The account's active login sessions (`GET /v1/auth/sessions`) with a "Gỡ"
 * action per row (`DELETE /v1/auth/sessions/{id}`).
 *
 * The current row is labelled "Thiết bị này" and CAN be revoked — that is the
 * API's intended reading of "đăng xuất khỏi thiết bị này". When it is, the
 * server action drops the session cookie and we send the user to /login with the
 * API's own message, so they are never left on a page whose next request 401s.
 */
export function SessionList({
  sessions,
  unavailable = false,
}: {
  sessions: SessionSummary[];
  unavailable?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const revoke = (id: string) => {
    setPendingId(id);
    void (async () => {
      try {
        const res = await revokeMySession(id);
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        toast.success(res.message);
        if (res.kind === 'current') {
          // The cookie is already gone server-side; this is a clean trip to the
          // login screen (the toast survives the client-side navigation).
          router.replace('/login');
          return;
        }
        router.refresh();
      } catch {
        toast.error(t('Không gỡ được phiên đăng nhập, thử lại sau'));
      } finally {
        setPendingId(null);
      }
    })();
  };

  if (unavailable) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('Không tải được danh sách phiên đăng nhập — thử tải lại trang nhé.')}
      </p>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('Không có phiên đăng nhập nào đang hoạt động.')}
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {t('Mỗi lần đăng nhập tạo một phiên. Gỡ phiên ở thiết bị bạn không dùng nữa để cắt quyền truy cập vào dữ liệu — không liên quan tới danh sách nhận thông báo ở trên.')}
      </p>
      <ul className="mt-3">
        {sessions.map((s, i) => {
          const label = sessionDeviceLabel(s.deviceLabel, locale);
          const platform = sessionPlatformLabel(s.platform, locale);
          const isMobile = s.platform === 'ios' || s.platform === 'android';
          const Icon = isMobile ? Smartphone : MonitorSmartphone;
          const pending = pendingId === s.id;
          return (
            <li
              key={s.id}
              className={cn('info-row flex items-center gap-3 py-3', i === 0 && '!border-t-0 pt-0')}
            >
              <span
                className={cn(
                  'icon-badge icon-badge-sm',
                  s.current ? 'tint-emerald' : 'tint-zinc',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {/* A <div>, not a <p>: <Badge> renders a <div> and nesting a
                    block element inside <p> is invalid HTML (React logs a
                    hydration error for it). The styling is unchanged. */}
                <div className="flex flex-wrap items-center gap-2 font-display text-sm font-bold text-ink">
                  <span className="truncate">{label}</span>
                  {s.current && <Badge variant="emerald">{t('Thiết bị này')}</Badge>}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {platform} • {t('Đăng nhập {date}', { date: formatDate(s.createdAt, locale) })} •{' '}
                  {t('Hoạt động {when}', { when: formatRelativeDay(s.lastSeenAt, locale) })} •{' '}
                  {t('Hết hạn {date}', { date: formatDate(s.expiresAt, locale) })}
                </p>
                {s.current && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('Gỡ phiên này tương đương đăng xuất — bạn sẽ được đưa về trang đăng nhập.')}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="rounded-pill border-border-strong bg-surface-2 text-ink-2 hover:bg-surface-3"
                disabled={pendingId !== null}
                aria-label={
                  s.current
                    ? t('Đăng xuất khỏi thiết bị này')
                    : t('Gỡ phiên đăng nhập trên {device}', { device: label })
                }
                onClick={() => revoke(s.id)}
              >
                {pending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : s.current ? (
                  <LogOut className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <ShieldOff className="mr-1 h-3.5 w-3.5" />
                )}
                {t('Gỡ')}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
