'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteAccount, type AuthFormState } from '@/app/actions/auth';

const CONFIRM_PHRASE = 'XOA TAI KHOAN';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="mr-2 h-4 w-4" />
      )}
      Xoá vĩnh viễn tài khoản
    </Button>
  );
}

export function DeleteAccountForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(deleteAccount, {});
  const [open, setOpen] = React.useState(false);
  const errors = state?.errors ?? {};

  if (!open) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Xoá tài khoản sẽ xoá toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt push. Không thể hoàn
          tác.
        </p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Tao muốn xoá tài khoản
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          Sau khi bấm xoá, toàn bộ dữ liệu của mày bị xoá vĩnh viễn. Tao khuyên mày
          xuất backup JSON trước.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="delete-password">Mật khẩu hiện tại</Label>
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
        <Label htmlFor="delete-confirm">
          Gõ <code className="font-mono text-destructive">{CONFIRM_PHRASE}</code> để xác nhận
        </Label>
        <Input
          id="delete-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          required
        />
        <FieldError errors={errors.confirm} />
      </div>
      {state?.message && !state.ok && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <SubmitButton />
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Huỷ
        </Button>
      </div>
    </form>
  );
}
