'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2, LogIn, UserPlus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  loginUser,
  registerUser,
  type AuthFormState,
} from '@/app/actions/auth';
import { useT } from '@/lib/i18n/client';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton({
  mode,
}: {
  mode: 'login' | 'register';
}) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : mode === 'login' ? (
        <LogIn className="mr-2 h-4 w-4" />
      ) : (
        <UserPlus className="mr-2 h-4 w-4" />
      )}
      {mode === 'login' ? t('Đăng nhập') : t('Tạo tài khoản')}
    </Button>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useT();
  const action = mode === 'login' ? loginUser : registerUser;
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const errors = state?.errors ?? {};
  const Icon = mode === 'login' ? ShieldCheck : UserPlus;
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');

  return (
    <div className="rounded-xl border-[1.5px] border-border bg-card p-7 shadow-lift sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 inline-flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary-soft text-primary-ink">
          <Icon className="h-7 w-7" />
        </div>
        <h1 className="display text-2xl">
          {mode === 'login' ? t('Chào mừng quay lại 👋') : t('Tạo tài khoản miễn phí')}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {mode === 'login'
            ? t('Đăng nhập để xem thiết bị, gói đăng ký và wishlist của bạn.')
            : t('Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo.')}
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        {mode === 'register' && (
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-sm font-semibold text-ink-2">
              {t('Tên hiển thị')}
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="vd: Trung"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted">{t('Để trống cũng được')}</p>
            <FieldError errors={errors.name} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-semibold text-ink-2">
            {t('Email')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="ban@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError errors={errors.email} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-semibold text-ink-2">
              {t('Mật khẩu')} <span className="text-destructive">*</span>
            </Label>
            {mode === 'login' && (
              <Link
                href="/forgot"
                className="text-xs font-semibold text-primary hover:underline"
              >
                {t('Quên mật khẩu?')}
              </Link>
            )}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            placeholder={mode === 'register' ? t('Tối thiểu 8 ký tự') : '••••••••'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && !errors.password && (
            <p className="text-xs text-muted">{t('Tối thiểu 8 ký tự')}</p>
          )}
          <FieldError errors={errors.password} />
        </div>

        {state?.message && (
          <p
            className={
              state.ok
                ? 'rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 px-3 py-2 text-sm font-medium text-emerald-ink'
                : 'rounded-md border-[1.5px] border-destructive/30 bg-destructive-soft/60 px-3 py-2 text-sm font-medium text-destructive'
            }
          >
            {state.message}
          </p>
        )}

        <SubmitButton mode={mode} />

        <p className="text-center text-sm text-muted">
          {mode === 'login' ? (
            <>
              {t('Chưa có tài khoản?')}{' '}
              <Link href="/register" className="font-semibold text-primary hover:underline">
                {t('Đăng ký')}
              </Link>
            </>
          ) : (
            <>
              {t('Đã có tài khoản?')}{' '}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                {t('Đăng nhập')}
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
