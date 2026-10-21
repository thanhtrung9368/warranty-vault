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
import { safeNextPath, withNext } from '@/lib/next-path';
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

export function AuthForm({
  mode,
  next,
}: {
  mode: 'login' | 'register';
  /**
   * Already validated by the page (`safeNextPath`). Re-validated before it is
   * rendered, because this is a client component and the prop crosses the RSC
   * boundary. The action validates it a third time — the hidden field is
   * browser-controlled.
   */
  next?: string | null;
}) {
  const t = useT();
  const safeNext = safeNextPath(next);
  // Carry the intent into the other auth form: a visitor who clicked a feature
  // card, hit "Sign up" and then changed their mind to sign in must not lose it.
  const switchHref = withNext(mode === 'login' ? '/register' : '/login', safeNext);
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
        {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
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

        {/* Consent is asked for exactly where the account is created, and it is
            a link to the real pages rather than a checkbox nobody can act on.
            The sentence is split at the two links, the same pattern the legal
            pages use for inline markup: each fragment is a whole translatable
            unit and the English can use its own article ("the", "our") without
            forcing the Vietnamese to grow one. */}
        {mode === 'register' && (
          <p className="text-center text-xs leading-relaxed text-muted">
            {t('Tạo tài khoản là bạn đồng ý với')}{' '}
            <Link href="/terms" className="font-semibold text-primary hover:underline">
              {t('Điều khoản sử dụng')}
            </Link>{' '}
            {t('và')}{' '}
            <Link href="/privacy" className="font-semibold text-primary hover:underline">
              {t('Chính sách bảo mật')}
            </Link>
            .
          </p>
        )}

        <p className="text-center text-sm text-muted">
          {mode === 'login' ? (
            <>
              {t('Chưa có tài khoản?')}{' '}
              <Link href={switchHref} className="font-semibold text-primary hover:underline">
                {t('Đăng ký')}
              </Link>
            </>
          ) : (
            <>
              {t('Đã có tài khoản?')}{' '}
              <Link href={switchHref} className="font-semibold text-primary hover:underline">
                {t('Đăng nhập')}
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
