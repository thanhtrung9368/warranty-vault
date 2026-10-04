'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/client';
import { deleteAccount, type AuthFormState } from '@/app/actions/auth';

// Machine-matched token: the Server Action `deleteAccount` compares the typed
// value against this exact ASCII literal, so it is NOT display copy and is
// never translated. Only the labels around it are.
const CONFIRM_PHRASE = 'XOA TAI KHOAN';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button
      type="submit"
      variant="destructive"
      disabled={pending}
      className="rounded-pill"
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="mr-2 h-4 w-4" />
      )}
      {t('Xoá vĩnh viễn tài khoản')}
    </Button>
  );
}

export function DeleteAccountForm() {
  const t = useT();
  const [state, formAction] = useActionState<AuthFormState, FormData>(deleteAccount, {});
  const [open, setOpen] = React.useState(false);
  const errors = state?.errors ?? {};

  if (!open) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          {t('Xoá tài khoản sẽ xoá toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt push. Không thể hoàn tác.')}
        </p>
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('Tao muốn xoá tài khoản')}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex items-start gap-3 rounded-md bg-destructive-soft p-3.5 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          {t('Sau khi bấm xoá, toàn bộ dữ liệu của mày bị xoá vĩnh viễn. Tao khuyên mày xuất backup JSON trước.')}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="delete-password" className="font-semibold">
          {t('Mật khẩu hiện tại')}
        </Label>
        <Input
          id="delete-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FieldError errors={errors.password} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="delete-confirm" className="font-semibold">
          {t('Gõ')}{' '}
          <code className="rounded bg-destructive-soft px-1.5 py-0.5 font-mono text-destructive">
            {CONFIRM_PHRASE}
          </code>{' '}
          {t('để xác nhận')}
        </Label>
        <Input
          id="delete-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          placeholder={CONFIRM_PHRASE}
          required
        />
        <FieldError errors={errors.confirm} />
      </div>
      {state?.message && !state.ok && (
        <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton />
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="rounded-pill"
        >
          {t('Huỷ')}
        </Button>
      </div>
    </form>
  );
}
