'use client';

import * as React from 'react';
import { Bell, BellOff, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
      toast.error('Thiếu VAPID public key trong .env');
      return;
    }
    setPending('sub');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'unsubscribed');
        toast.error('Bạn cần cho phép thông báo');
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
        toast.success('Đã bật thông báo cho thiết bị này');
      } else {
        toast.error(res.message ?? 'Không đăng ký được');
      }
    } catch (e) {
      toast.error(`Lỗi: ${(e as Error).message}`);
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
      toast.success('Đã tắt thông báo trên thiết bị này');
    } catch (e) {
      toast.error(`Lỗi: ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  const testPush = async () => {
    setPending('test');
    try {
      const res = await sendTestPush();
      if (res.ok) toast.success(res.message ?? 'Đã gửi');
      else toast.error(res.message ?? 'Không gửi được');
    } finally {
      setPending(null);
    }
  };

  if (state === 'unsupported') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          Trình duyệt này chưa hỗ trợ push notification. Thử Chrome, Edge, Firefox hoặc Safari
          phiên bản mới.
        </p>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          Bạn đã chặn thông báo từ site này. Mở cài đặt trình duyệt → quyền thông báo → cho phép rồi tải lại trang.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Nhận thông báo khi thiết bị sắp hết bảo hành, ngay cả khi không mở web.
      </p>
      <div className="flex flex-wrap gap-2">
        {state === 'subscribed' ? (
          <>
            <div className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Thiết bị này đã bật thông báo
            </div>
            <Button variant="outline" size="sm" onClick={testPush} disabled={pending !== null}>
              {pending === 'test' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Gửi thử
            </Button>
            <Button variant="ghost" size="sm" onClick={unsubscribe} disabled={pending !== null}>
              {pending === 'unsub' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BellOff className="mr-2 h-4 w-4" />
              )}
              Tắt
            </Button>
          </>
        ) : (
          <Button onClick={subscribe} disabled={pending !== null}>
            {pending === 'sub' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Bell className="mr-2 h-4 w-4" />
            )}
            Bật thông báo
          </Button>
        )}
      </div>
    </div>
  );
}
