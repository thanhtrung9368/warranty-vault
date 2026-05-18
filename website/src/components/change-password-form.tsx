'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, KeyRound, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePassword, type AuthFormState } from '@/app/actions/auth';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <KeyRound className="mr-2 h-4 w-4" />
      )}
      Đổi mật khẩu
    </Button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(changePassword, {});
  const errors = state?.errors ?? {};
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Đã đổi mật khẩu');
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Mật khẩu hiện tại</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        <FieldError errors={errors.currentPassword} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="newPassword">Mật khẩu mới</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <FieldError errors={errors.newPassword} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Xác nhận mật khẩu mới</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <FieldError errors={errors.confirmPassword} />
        </div>
      </div>
      {state?.message && !state.ok && (
        <p className="rounded-md border-[1.5px] border-destructive/30 bg-destructive-soft/60 px-3 py-2 text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
      {state?.ok && (
        <p className="inline-flex items-center gap-2 rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 px-3 py-2 text-sm font-medium text-emerald-ink">
          <CheckCircle2 className="h-4 w-4" />
          {state.message}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
