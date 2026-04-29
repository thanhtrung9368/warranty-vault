'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
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
    <Button type="submit" disabled={pending} className="w-full">
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
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">
          {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </CardTitle>
        <CardDescription>
          {mode === 'login'
            ? 'Quay lại quản lý thiết bị của bạn'
            : 'Bắt đầu theo dõi bảo hành thiết bị'}
        </CardDescription>
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
