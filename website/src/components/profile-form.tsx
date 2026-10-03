'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Save, CheckCircle2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateProfile, type AuthFormState } from '@/app/actions/auth';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-2 h-4 w-4" />
      )}
      Lưu hồ sơ
    </Button>
  );
}

// Profile editor for the display name. `PATCH /v1/auth/me` accepts that field
// and nothing else, so the account email is rendered read-only here — changing
// it is a separate two-step flow (`change-email` → token mailed to the NEW
// address → `confirm-email-change`) whose request form is `EmailChangeForm`,
// rendered next to this one in the Hồ sơ section.
//
// The name cap is 80 *bytes* of UTF-8 (~26 Vietnamese characters), enforced in
// Go. We intentionally do not pre-validate a character count here — the
// server's Vietnamese message is surfaced through `state.errors.displayName`.
export function ProfileForm({ email, initialName }: { email: string; initialName: string | null }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(updateProfile, {});
  const errors = state?.errors ?? {};
  // The input is controlled so a failed/cleared save keeps what the user typed;
  // it is seeded from the server-rendered user on first paint.
  const [name, setName] = React.useState(initialName ?? '');

  const initialMount = React.useRef(true);
  React.useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (state?.ok) toast.success(state.message ?? 'Đã cập nhật hồ sơ');
    else if (state?.message) toast.error(state.message);
  }, [state]);

  // Re-seed the input from the server's stored value after a successful save:
  // the server trims, so typing "  Trung  " comes back as "Trung". The prop
  // only changes when the action revalidated, so a failed save keeps whatever
  // the user typed.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(initialName ?? '');
  }, [initialName]);

  const trimmed = name.trim();

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Tên hiển thị</Label>
        <Input
          id="displayName"
          name="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="vd: Trung Nguyễn"
          autoComplete="name"
        />
        <FieldError errors={errors.displayName} />
        <p className="text-xs text-muted-foreground">
          Tên hiển thị ở thanh trên cùng và lời chào trên bảng điều khiển. Tối đa 80 byte — tên
          tiếng Việt có dấu tốn nhiều byte hơn số ký tự. Để trống rồi lưu nếu muốn xoá tên.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profileEmail">Email đăng nhập</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="profileEmail"
            value={email}
            readOnly
            className="pl-9"
            aria-describedby="profileEmailHint"
          />
        </div>
        <p id="profileEmailHint" className="text-xs text-muted-foreground">
          Email dùng để đăng nhập. Đổi được bằng mục <strong className="font-semibold">Đổi email
          đăng nhập</strong> ngay bên dưới — cần mật khẩu hiện tại và một bước xác nhận qua email
          gửi tới địa chỉ mới.
        </p>
      </div>

      {state?.ok && (
        <p className="inline-flex items-center gap-2 rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 px-3 py-2 text-sm font-medium text-emerald-ink">
          <CheckCircle2 className="h-4 w-4" />
          {state.message ?? 'Đã cập nhật hồ sơ'}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {trimmed ? `Đang dùng: ${trimmed}` : 'Chưa đặt tên hiển thị.'}
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
