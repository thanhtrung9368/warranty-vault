'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  resetPassword,
  type ResetRequestState,
} from '@/app/actions/password-reset';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      size="lg"
      className="w-full rounded-full transition-transform hover:scale-[1.01]"
    >
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
    <Card className="rounded-2xl border-border/60 shadow-xl shadow-primary/5">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">
            Đặt lại mật khẩu
          </CardTitle>
          <CardDescription>
            Chọn mật khẩu mới mạnh hơn nha — tối thiểu 8 ký tự.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {state?.ok ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{state.message}</p>
            </div>
            <Button
              asChild
              size="lg"
              className="w-full rounded-full transition-transform hover:scale-[1.01]"
            >
              <Link href="/login">Đăng nhập ngay</Link>
            </Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <div className="space-y-2">
              <Label htmlFor="newPassword">
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
                <p className="text-xs text-destructive">{errors.newPassword[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
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
                <p className="text-xs text-destructive">{errors.confirmPassword[0]}</p>
              )}
            </div>
            {state?.message && !state.ok && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.message}
              </p>
            )}
            <SubmitButton />
            <p className="text-center text-sm text-muted-foreground">
              <Link
                href="/login"
                className="inline-flex items-center font-medium text-primary hover:underline"
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Quay lại đăng nhập
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
