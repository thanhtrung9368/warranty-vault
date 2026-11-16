'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Check, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { claimHandoff } from '@/app/actions/handoff';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  handoffFailureBody,
  handoffFailureTitle,
  type HandoffFailureReason,
} from '@/lib/handoff';
import { withNext } from '@/lib/next-path';

type ClaimResult = { deviceId: string; deviceName: string };

/**
 * The buyer's half of the public claim page. Rendered only when the visitor is
 * signed in; the signed-out page shows the sign-in CTA instead.
 *
 * Claiming is irreversible and single-use, so the first click opens a
 * confirmation step rather than spending the code. The server is idempotent for
 * the SAME buyer (a reload/retry is still a 200), which is why a successful
 * response always means "this device is yours to open", never "you lost a
 * race".
 */
export function HandoffClaim({ code }: { code: string }) {
  const t = useT();
  const locale = useLocale();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<ClaimResult | null>(null);
  const [failure, setFailure] = React.useState<{
    reason: HandoffFailureReason;
    message: string;
  } | null>(null);

  const submit = async () => {
    setPending(true);
    setFailure(null);
    try {
      const res = await claimHandoff(code);
      if (!res.ok) {
        setFailure({ reason: res.reason, message: res.message });
        setConfirming(false);
        return;
      }
      setResult({ deviceId: res.deviceId, deviceName: res.deviceName });
    } catch {
      toast.error(t('Không nhận được thiết bị. Thử lại sau.'));
      setFailure({
        reason: 'error',
        message: handoffFailureBody('error', locale),
      });
    } finally {
      setPending(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-4 rounded-2xl border-[1.5px] border-emerald-ink/40 bg-emerald-soft p-5">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-ink">
          <Check className="h-5 w-5 text-emerald-ink" />
          {t('Đã nhận thiết bị')}
        </p>
        <p className="text-sm font-semibold text-ink">{result.deviceName}</p>
        <p className="text-sm leading-relaxed text-ink-2">
          {t(
            'Thiết bị đã nằm trong tài khoản của bạn, kèm bảo hành còn lại và các tài liệu người bán chọn gửi.',
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(
            'Đây là bản bạn nhận qua Warrly. Người bán giữ một bản đã bán và không còn xem được thiết bị này.',
          )}
        </p>
        <Button asChild className="rounded-pill">
          <Link href={`/devices/${result.deviceId}`}>
            {t('Mở thiết bị của bạn')}
          </Link>
        </Button>
      </div>
    );
  }

  if (failure) {
    const signInHref = withNext('/login', `/handoff/${code}`);
    return (
      <div className="space-y-3 rounded-2xl border-[1.5px] border-destructive/40 bg-destructive-soft p-5 text-destructive">
        <p className="flex items-center gap-2 font-display text-lg font-bold">
          <AlertTriangle className="h-5 w-5" />
          {handoffFailureTitle(failure.reason, locale)}
        </p>
        <p className="text-sm leading-relaxed">{failure.message}</p>
        {failure.reason === 'auth' && (
          <Button asChild className="rounded-pill">
            <Link href={signInHref}>{t('Đăng nhập để nhận')}</Link>
          </Button>
        )}
        {(failure.reason === 'error' || failure.reason === 'rate_limited') && (
          <Button
            type="button"
            variant="outline"
            className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
            onClick={() => {
              setFailure(null);
              setConfirming(false);
            }}
          >
            {t('Thử lại')}
          </Button>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          size="lg"
          className="w-full rounded-pill sm:w-auto"
          onClick={() => setConfirming(true)}
        >
          {t('Nhận thiết bị')}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            'Thiết bị và các tài liệu đã chọn sẽ được sao vào tài khoản bạn. Người bán giữ một bản đã bán và không còn xem được thiết bị này. Mã chỉ dùng được một lần.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border-[1.5px] border-border bg-surface-2 p-5">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-ink" />
        <span>
          {t(
            'Thiết bị và các tài liệu đã chọn sẽ được sao vào tài khoản bạn. Người bán giữ một bản đã bán và không còn xem được thiết bị này. Mã chỉ dùng được một lần.',
          )}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="rounded-pill"
          onClick={submit}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-4 w-4" />
          )}
          {pending ? t('Đang nhận thiết bị…') : t('Xác nhận nhận thiết bị')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-pill border-border-strong"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {t('Để sau')}
        </Button>
      </div>
    </div>
  );
}
