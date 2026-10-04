'use client';

import * as React from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';
import { subscribePush, unsubscribePush, sendTestPush } from '@/app/actions/push';

function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buffer;
}

type State = 'idle' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

export function PushSettings() {
  const t = useT();
  const [state, setState] = React.useState<State>('idle');
  const [pending, setPending] = React.useState<'sub' | 'unsub' | 'test' | null>(null);
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection needs browser API
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'subscribed' : 'unsubscribed');
      } catch {
        setState('unsubscribed');
      }
    })();
  }, []);

  const subscribe = async () => {
    if (!vapidPublicKey) {
      toast.error(t('Thiếu VAPID public key trong .env'));
      return;
    }
    setPending('sub');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'unsubscribed');
        toast.error(t('Bạn cần cho phép thông báo'));
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
        });
      }
      const json = sub.toJSON();
      const res = await subscribePush({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
        userAgent: navigator.userAgent.slice(0, 500),
      });
      if (res.ok) {
        setState('subscribed');
        toast.success(t('Đã bật thông báo cho thiết bị này'));
      } else {
        toast.error(res.message ?? t('Không đăng ký được'));
      }
    } catch (e) {
      toast.error(t('Lỗi: {message}', { message: (e as Error).message }));
    } finally {
      setPending(null);
    }
  };

  const unsubscribe = async () => {
    setPending('unsub');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState('unsubscribed');
      toast.success(t('Đã tắt thông báo trên thiết bị này'));
    } catch (e) {
      toast.error(t('Lỗi: {message}', { message: (e as Error).message }));
    } finally {
      setPending(null);
    }
  };

  const testPush = async () => {
    setPending('test');
    try {
      const res = await sendTestPush();
      if (res.ok) toast.success(res.message ?? t('Đã gửi'));
      else toast.error(res.message ?? t('Không gửi được'));
    } finally {
      setPending(null);
    }
  };

  if (state === 'unsupported') {
    return (
      <div className="flex items-start gap-3 rounded-md bg-zinc-soft p-3.5 text-sm text-ink-2">
        <BellOff className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          {t('Trình duyệt này chưa hỗ trợ push notification. Thử Chrome, Edge, Firefox hoặc Safari phiên bản mới.')}
        </p>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="flex items-start gap-3 rounded-md bg-rose-soft p-3.5 text-sm text-rose-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          {t('Bạn đã chặn thông báo từ site này. Mở cài đặt trình duyệt → quyền thông báo → cho phép rồi tải lại trang.')}
        </p>
      </div>
    );
  }

  if (state === 'subscribed') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-md bg-emerald-soft p-3.5 text-sm text-emerald-ink">
          <span className="icon-badge icon-badge-xs tint-emerald">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <span className="font-medium">{t('Thiết bị này đã bật thông báo')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-pill"
            onClick={testPush}
            disabled={pending !== null}
          >
            {pending === 'test' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('Gửi thử')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-pill"
            onClick={unsubscribe}
            disabled={pending !== null}
          >
            {pending === 'unsub' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BellOff className="mr-2 h-4 w-4" />
            )}
            {t('Tắt')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('Nhận thông báo khi thiết bị sắp hết bảo hành, ngay cả khi không mở web.')}
      </p>
      <Button
        size="lg"
        className="rounded-pill"
        onClick={subscribe}
        disabled={pending !== null}
      >
        {pending === 'sub' ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <BellRing className="mr-2 h-4 w-4" />
        )}
        {t('Bật thông báo')}
      </Button>
    </div>
  );
}
