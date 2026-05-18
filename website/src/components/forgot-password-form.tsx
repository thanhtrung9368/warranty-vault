'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, Mail, CheckCircle2, ArrowLeft, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  requestPasswordReset,
  type ResetRequestState,
} from '@/app/actions/password-reset';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Mail className="mr-2 h-4 w-4" />
      )}
      Gửi link đặt lại
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ResetRequestState, FormData>(
    requestPasswordReset,
    {},
  );
  const errors = state?.errors ?? {};

  return (
    <div className="rounded-xl border-[1.5px] border-border bg-card p-7 shadow-lift sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-amber-soft text-amber-ink">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="display text-2xl">Lỡ tay quên mật khẩu hả?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Nhập email tài khoản, bọn tao gửi link đặt lại trong vài giây.
        </p>
      </div>

      {state?.ok ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 p-3 text-sm font-medium text-emerald-ink">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{state.message}</p>
          </div>
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Quay lại đăng nhập
            </Link>
          </Button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-semibold text-ink-2">
              Email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="ban@example.com"
              autoComplete="email"
              required
            />
            {errors.email && (
              <p className="text-xs font-medium text-destructive">{errors.email[0]}</p>
            )}
          </div>
          {state?.message && !state.ok && (
            <p className="rounded-md border-[1.5px] border-destructive/30 bg-destructive-soft/60 px-3 py-2 text-sm font-medium text-destructive">
              {state.message}
            </p>
          )}
          <SubmitButton />
          <p className="text-center text-sm text-muted">
            <Link href="/login" className="font-semibold text-primary hover:underline">
              ← Quay lại đăng nhập
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
