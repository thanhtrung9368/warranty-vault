'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, LogIn, UserPlus, Vault } from 'lucide-react';
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
  loginUser,
  registerUser,
  type AuthFormState,
} from '@/app/actions/auth';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

function SubmitButton({
  mode,
}: {
  mode: 'login' | 'register';
}) {
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
      ) : mode === 'login' ? (
        <LogIn className="mr-2 h-4 w-4" />
      ) : (
        <UserPlus className="mr-2 h-4 w-4" />
      )}
      {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
    </Button>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const action = mode === 'login' ? loginUser : registerUser;
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

  return (
    <Card className="rounded-2xl border-border/60 shadow-xl shadow-primary/5">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Vault className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">
            {mode === 'login' ? 'Chào mừng quay lại 👋' : 'Tạo tài khoản miễn phí'}
          </CardTitle>
          <CardDescription>
            {mode === 'login'
              ? 'Đăng nhập để xem thiết bị, gói đăng ký và wishlist của bạn.'
              : 'Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-2">
              <Label htmlFor="name">Tên hiển thị</Label>
              <Input
                id="name"
                name="name"
                placeholder="vd: Trung"
                autoComplete="name"
                maxLength={80}
              />
              <FieldError errors={errors.name} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">
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
            <FieldError errors={errors.email} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">
                Mật khẩu <span className="text-destructive">*</span>
              </Label>
              {mode === 'login' && (
                <Link
                  href="/forgot"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Quên mật khẩu?
                </Link>
              )}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              placeholder={mode === 'register' ? 'Tối thiểu 8 ký tự' : ''}
              required
            />
            <FieldError errors={errors.password} />
          </div>

          {state?.message && (
            <p
              className={
                state.ok
                  ? 'rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
              }
            >
              {state.message}
            </p>
          )}

          <SubmitButton mode={mode} />

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                Chưa có tài khoản?{' '}
                <Link href="/register" className="font-medium text-primary hover:underline">
                  Đăng ký
                </Link>
              </>
            ) : (
              <>
                Đã có tài khoản?{' '}
                <Link href="/login" className="font-medium text-primary hover:underline">
                  Đăng nhập
                </Link>
              </>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
