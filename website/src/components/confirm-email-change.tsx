'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, MailCheck, CheckCircle2, ArrowLeft, LogIn, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmEmailChange, type ConfirmEmailChangeState } from '@/app/actions/email-change';
import { useT } from '@/lib/i18n/client';

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <MailCheck className="mr-2 h-4 w-4" />
      )}
      {pending ? t('Đang xác nhận…') : t('Xác nhận đổi email')}
    </Button>
  );
}

// Confirmation screen for the link mailed to the NEW address
// (`<APP_URL>/confirm-email/<token>`). Structurally mirrors
// `reset-password-form.tsx`: a token out of the URL, one POST, then a success
// or a failure state.
//
// The POST is only sent when the user presses the button — never on mount. The
// token is single-use, so an automatic submit would turn a double-rendered
// effect (React Strict Mode in dev, a bfcache replay, a link prefetcher that
// runs JS) into a spurious "link đã dùng" error for a token that was valid.
export function ConfirmEmailChange({ token }: { token: string }) {
  const t = useT();
  const [state, formAction] = useActionState<ConfirmEmailChangeState, FormData>(
    confirmEmailChange,
    {},
  );

  return (
    <div className="rounded-xl border-[1.5px] border-border bg-card p-7 shadow-lift sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary-soft text-primary-ink">
          <MailCheck className="h-7 w-7" />
        </div>
        {/* These two sentences are also `CONFIRM_EMAIL_COPY` in
            `lib/email-change.ts` (used by the settings email-change form). They
            are wrapped here rather than read from that module so this screen
            translates on its own — the constant is plain Vietnamese and has no
            locale-aware getter. */}
        <h1 className="display text-2xl">{t('Xác nhận đổi email')}</h1>
        <p className="mt-1.5 text-sm text-muted">
          {t(
            'Link này xác nhận địa chỉ email mới cho tài khoản WarrantyVault của bạn. Bạn có thể mở link trên điện thoại — không cần đăng nhập trước.',
          )}
        </p>
      </div>

      {state?.ok ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 p-3 text-sm font-medium text-emerald-ink">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1">
              {/* The server's own wording ("Đã đổi email. Vào /login…"). */}
              <p>{state.message}</p>
              {state.hint && <p className="font-normal">{state.hint}</p>}
            </div>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/login">
              <LogIn className="mr-2 h-4 w-4" />
              {t('Đăng nhập bằng email mới')}
            </Link>
          </Button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          {state?.title && (
            <div className="flex items-start gap-2.5 rounded-md border-[1.5px] border-destructive/30 bg-destructive-soft/60 p-3 text-sm font-medium text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="space-y-1">
                <p>{state.title}</p>
                <p className="font-normal">{state.message}</p>
                {state.hint && <p className="font-normal">{state.hint}</p>}
              </div>
            </div>
          )}

          <SubmitButton />

          <p className="text-center text-sm text-muted">
            <Link
              href="/login"
              className="inline-flex items-center font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              {t('Quay lại đăng nhập')}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
