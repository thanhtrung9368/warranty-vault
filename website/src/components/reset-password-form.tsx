'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, KeyRound, CheckCircle2, ArrowLeft, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  resetPassword,
  type ResetRequestState,
} from '@/app/actions/password-reset';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <KeyRound className="mr-2 h-4 w-4" />
      )}
      Đổi mật khẩu
    </Button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetRequestState, FormData>(resetPassword, {});
  const errors = state?.errors ?? {};

  return (
    <div className="rounded-xl border-[1.5px] border-border bg-card p-7 shadow-lift sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary-soft text-primary-ink">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="display text-2xl">Đặt lại mật khẩu</h1>
        <p className="mt-1.5 text-sm text-muted">
          Chọn mật khẩu mới mạnh hơn nha — tối thiểu 8 ký tự.
        </p>
      </div>

      {state?.ok ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 p-3 text-sm font-medium text-emerald-ink">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{state.message}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/login">
              <LogIn className="mr-2 h-4 w-4" />
              Đăng nhập ngay
            </Link>
          </Button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div className="space-y-1.5">
            <Label htmlFor="newPassword" className="text-sm font-semibold text-ink-2">
              Mật khẩu mới <span className="text-destructive">*</span>
            </Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="Tối thiểu 8 ký tự"
              required
            />
            {errors.newPassword && (
              <p className="text-xs font-medium text-destructive">{errors.newPassword[0]}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="text-sm font-semibold text-ink-2">
              Xác nhận mật khẩu <span className="text-destructive">*</span>
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="Nhập lại mật khẩu mới"
              required
            />
            {errors.confirmPassword && (
              <p className="text-xs font-medium text-destructive">{errors.confirmPassword[0]}</p>
            )}
          </div>
          {state?.message && !state.ok && (
            <p className="rounded-md border-[1.5px] border-destructive/30 bg-destructive-soft/60 px-3 py-2 text-sm font-medium text-destructive">
              {state.message}
            </p>
          )}
          <SubmitButton />
          <p className="text-center text-sm text-muted">
            <Link
              href="/login"
              className="inline-flex items-center font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Quay lại đăng nhập
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
